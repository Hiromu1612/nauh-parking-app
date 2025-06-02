import os
import sys
import json
import asyncio
import threading
import websockets
import logging
import cv2
import time
import signal
import base64
import httpx
from datetime import datetime
from dotenv import load_dotenv
from ultralytics import solutions

# 基本的なロギング設定
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger(__name__)

# 環境変数の読み込み
load_dotenv()
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_ANON_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    logger.error("環境変数が未設定です")
    sys.exit(1)

# WebSocketのURL
REALTIME_URL = f"wss://{SUPABASE_URL.replace('https://', '')}/realtime/v1/websocket?apikey={SUPABASE_KEY}&vsn=1.0.0"

# グローバル変数
ws_connection = None
channel_joined = False
connection_event = asyncio.Event()
command_event = asyncio.Event()
stop_detection_flag = threading.Event()

# 保存頻度の設定（5フレームに1回）
SAVE_FREQUENCY = 5

# 駐車場データの統計情報
total_parking_count = 0  # 駐車台数の合計
total_cars = 0  # 普通車の合計台数
total_large_cars = 0  # 中型・大型車の合計台数
parking_durations = {}
previous_status = {}

# 実行状態を管理するクラス
class ProgramState:
    def __init__(self):
        self.running = False
        self.stop_event = threading.Event()
        self.connected = False
    
    def stop(self):
        logger.info("検知停止")
        self.running = False
        self.stop_event.set()
    
    def start(self):
        logger.info("検知開始")
        self.running = True
        self.stop_event.clear()
    
    def is_running(self):
        return self.running
    
    def set_connected(self, status):
        self.connected = status
    
    def is_connected(self):
        return self.connected

program_state = ProgramState()

# ステータスを送信する関数
async def send_status(status):
    if ws_connection and ws_connection.open and channel_joined:
        try:
            message = {
                "topic": "realtime:python-control",
                "event": "broadcast",
                "payload": {"status": status},
                "ref": None
            }
            await ws_connection.send(json.dumps(message))
            return True
        except Exception as e:
            logger.error(f"ステータス送信エラー: {e}")
            return False
    return False

# WebSocketメッセージを処理する関数
async def handle_message(message):
    global channel_joined
    
    try:
        data = json.loads(message)
        
        # 参照メッセージの処理
        if "ref" in data and data.get("event") == "phx_reply" and data.get("payload", {}).get("status") == "ok":
            if not channel_joined and "topic" in data and data["topic"] == "realtime:python-control":
                channel_joined = True
                program_state.set_connected(True)
                logger.info("Supabase Realtimeに接続完了")
                connection_event.set()
                await send_status("stopped")
        
        # broadcastイベントの処理
        if data.get("event") == "broadcast" and data.get("topic") == "realtime:python-control":
            payload = data.get("payload", {})
            
            # コマンドの処理
            if "command" in payload.get("payload", {}):
                command = payload["payload"]["command"]
                
                if command == "stop":
                    program_state.stop()
                    stop_detection_flag.set()
                    await send_status("stopped")
                    command_event.set()
                    
                elif command == "start":
                    program_state.start()
                    stop_detection_flag.clear()
                    await send_status("running")
                    command_event.set()
                    
                elif command == "status":
                    current_status = "running" if program_state.is_running() else "stopped"
                    await send_status(current_status)
    except Exception as e:
        logger.error(f"メッセージ処理エラー: {e}")

# Supabaseにデータを保存する関数
def save_to_supabase(data):
    try:
        url = f"{SUPABASE_URL}/rest/v1/parking_data"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"  # 応答を最小限にする
        }
        
        # 同期的にHTTPリクエストを送信
        response = httpx.post(url, headers=headers, json=data, timeout=10.0)
        
        if response.status_code == 201:
            logger.info("データベースへの保存に成功しました")
            return True
        else:
            logger.error(f"データベースへの保存に失敗しました: {response.status_code} {response.text}")
            return False
    except Exception as e:
        logger.error(f"データベース保存エラー: {e}")
        return False

# Supabaseのストレージに画像をアップロードする関数
def upload_to_storage(file_path, storage_path):
    try:
        url = f"{SUPABASE_URL}/storage/v1/object/Parking_picture/{storage_path}"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/octet-stream"
        }
        
        # ファイルが存在するか確認
        if not os.path.exists(file_path):
            logger.error(f"ファイルが存在しません: {file_path}")
            return None
            
        with open(file_path, "rb") as f:
            # 同期的にHTTPリクエストを送信
            response = httpx.put(url, headers=headers, content=f.read(), timeout=30.0)
            
            if response.status_code == 200:
                logger.info(f"画像のアップロードに成功しました: {storage_path}")
                return f"{SUPABASE_URL}/storage/v1/object/public/Parking_picture/{storage_path}"
            else:
                logger.error(f"画像のアップロードに失敗しました: {response.status_code} {response.text}")
                return None
    except Exception as e:
        logger.error(f"画像アップロードエラー: {e}")
        return None

# 物体検知を実行する関数
def run_detection():
    global total_parking_count, total_cars, total_large_cars, parking_durations, previous_status
    
    try:
        # 検知開始時にステータスを送信
        threading.Thread(target=lambda: asyncio.run(send_status("running"))).start()
        logger.info("物体検知を開始します")
        
        # 日付フォルダの作成
        current_time = datetime.now()
        date_str = current_time.strftime("%Y-%m-%d")
        exp_dir = f'runs/{date_str}'
        if not os.path.exists(exp_dir):
            os.makedirs(exp_dir)
        
        # ビデオキャプチャの設定
        cap = cv2.VideoCapture("Parking_another.mp4")
        
        if not cap.isOpened():
            logger.error("ビデオファイルを開けませんでした")
            return
        
        w, h, fps = (int(cap.get(x)) for x in (cv2.CAP_PROP_FRAME_WIDTH, cv2.CAP_PROP_FRAME_HEIGHT, cv2.CAP_PROP_FPS))
        
        # ビデオライターの設定
        video_writer = cv2.VideoWriter(
            os.path.join(exp_dir, "Parking_yolov8.mp4"), 
            cv2.VideoWriter_fourcc(*"mp4v"), 
            fps, 
            (w, h)
        )
        
        # 駐車場管理オブジェクトの初期化
        parking_manager = solutions.ParkingManagement(
            model="models/yolov8m.pt",
            json_file="regions/under.json",
        )
        
        frame_count = 0
        
        while cap.isOpened() and not stop_detection_flag.is_set():
            start_time = datetime.now()
            ret, im0 = cap.read()
            if not ret:
                break
            
            # 物体検知の実行
            try:
                im0, json_result_str = parking_manager.process_data(im0)
                json_result = json.loads(json_result_str)
            except Exception as e:
                logger.error(f"物体検知処理エラー: {e}")
                json_result = None
                continue
            
            if isinstance(im0, tuple):
                im0 = im0[0]
            
            # 動画に書き込み
            video_writer.write(im0)
            
            # 駐車台数の合計と駐車時間を計算
            current_total_cars = 0
            current_total_large_cars = 0
            
            if json_result:
                for space in json_result.get('parking_lot_status', []):
                    space_id = space["space_id"]
                    if space_id not in parking_durations:
                        parking_durations[space_id] = 0
                    if space_id not in previous_status:
                        previous_status[space_id] = space['status']
                    
                    if space['status'] == 'occupied':
                        parking_durations[space_id] += 1
                        if previous_status[space_id] == 'empty':
                            total_parking_count += 1
                            # 車両タイプに基づいてそれぞれの合計台数をカウント
                            if 1 <= int(space_id) <= 18:  # 普通車エリア
                                current_total_cars += 1
                            elif 19 <= int(space_id) <= 25:  # 中型・大型車エリア
                                current_total_large_cars += 1
                    
                    previous_status[space_id] = space['status']
                
                # 最初のフレームでoccupiedの数を初期値として設定
                if frame_count == 0:
                    for space in json_result.get('parking_lot_status', []):
                        if space['status'] == 'occupied':
                            if 1 <= int(space['space_id']) <= 18:
                                total_cars += 1
                            elif 19 <= int(space['space_id']) <= 25:
                                total_large_cars += 1
                    total_parking_count = total_cars + total_large_cars
                else:
                    total_cars += current_total_cars
                    total_large_cars += current_total_large_cars
            
            # 5フレームに1回だけデータを保存
            if frame_count % SAVE_FREQUENCY == 0:
                timestamp = datetime.now()
                
                # 画像をファイルに保存
                frame_filename = os.path.join(exp_dir, f"{timestamp.strftime('%H-%M-%S')}.jpg")
                storage_path = f"{date_str}/{timestamp.strftime('%H-%M-%S')}.jpg"
                cv2.imwrite(frame_filename, im0)
                logger.info(f"画像をファイルに保存しました: {frame_filename}")
                
                # 画像をSupabaseストレージにアップロード
                public_url = upload_to_storage(frame_filename, storage_path)
                
                if public_url:
                    # Supabaseにデータを送信
                    data = {
                        'timestamp': timestamp.isoformat(),
                        'frame_count': frame_count,
                        'frame_path': public_url,
                        'total_parking_count': total_parking_count,
                        'total_cars': total_cars,
                        'total_large_cars': total_large_cars,
                    }
                    
                    if json_result:
                        data.update({
                            'total_empty_spaces': json_result.get('total_empty_spaces', 0),
                            'total_occupied_spaces': json_result.get('total_occupied_spaces', 0),
                        })
                        
                        for space in json_result.get('parking_lot_status', []):
                            space_id = space["space_id"]
                            data[f'space_{space_id}'] = space['status']
                            data[f'duration_{space_id}'] = parking_durations[space_id]
                    
                    # データをSupabaseに保存
                    save_success = save_to_supabase(data)
                    
                    if save_success:
                        logger.info(f"フレーム {frame_count} のデータを保存しました")
                    else:
                        logger.error(f"フレーム {frame_count} のデータ保存に失敗しました")
                else:
                    logger.error(f"画像のアップロードに失敗したため、データ保存をスキップします")
            else:
                logger.debug(f"フレーム {frame_count} はスキップします（保存なし）")
            
            # 処理時間の計算
            end_time = datetime.now()
            process_duration = (end_time - start_time).total_seconds()
            logger.info(f"✔︎ 物体検知完了 ({process_duration:.6f} s)")
            
            frame_count += 1
            
            # 停止フラグをチェック
            if stop_detection_flag.is_set():
                logger.info("検知を停止します")
                break
        
        cap.release()
        video_writer.release()
        logger.info(f"検知結果を保存しました: {exp_dir}")
        
    except Exception as e:
        logger.error(f"物体検知エラー: {e}")
    finally:
        logger.info("物体検知終了")
        # 検知終了時にステータスを送信
        threading.Thread(target=lambda: asyncio.run(send_status("stopped"))).start()

# WebSocketクライアント
async def realtime_client():
    global ws_connection, channel_joined
    
    while True:
        try:
            logger.info("Supabase Realtimeに接続中...")
            async with websockets.connect(REALTIME_URL, ping_interval=30) as websocket:
                ws_connection = websocket
                
                # チャンネルに参加
                join_message = {
                    "topic": "realtime:python-control",
                    "event": "phx_join",
                    "payload": {},
                    "ref": "1"
                }
                await websocket.send(json.dumps(join_message))
                
                # メッセージの受信ループ
                while True:
                    message = await websocket.recv()
                    await handle_message(message)
                    
        except Exception as e:
            logger.error(f"WebSocket接続エラー: {e}")
            channel_joined = False
            ws_connection = None
            program_state.set_connected(False)
            await asyncio.sleep(5)

# メインの処理関数
async def main_task():
    global detection_thread
    
    # 接続が確立されるまで待機
    try:
        await asyncio.wait_for(connection_event.wait(), timeout=30)
    except asyncio.TimeoutError:
        logger.warning("接続タイムアウト")
    
    # メインループ
    while True:
        try:
            if program_state.is_running():
                # 実行中の場合、物体検知を開始
                detection_thread = threading.Thread(target=run_detection)
                detection_thread.start()
                
                # 停止コマンドを待機
                command_event.clear()
                await command_event.wait()
                
                # 状態を再確認
                if not program_state.is_running():
                    # スレッドが終了するのを待機
                    if detection_thread and detection_thread.is_alive():
                        detection_thread.join(timeout=10)
            else:
                # 停止中の場合、開始コマンドを待機
                await send_status("stopped")
                
                # コマンドイベントをリセット
                command_event.clear()
                
                # コマンドを待機
                await command_event.wait()
        
        except Exception as e:
            logger.error(f"メインタスクエラー: {e}")
            await asyncio.sleep(5)

# メイン関数
async def main():
    try:
        # WebSocketクライアントとメインタスクを並行して実行
        await asyncio.gather(
            realtime_client(),
            main_task()
        )
    except Exception as e:
        logger.error(f"メイン処理エラー: {e}")
        return 1

# プログラムの実行
if __name__ == "__main__":
    try:
        # SIGINTシグナル（Ctrl+C）のハンドラを設定
        def signal_handler(sig, frame):
            logger.info("プログラム終了")
            program_state.stop()
            stop_detection_flag.set()
            sys.exit(0)
        
        signal.signal(signal.SIGINT, signal_handler)
        
        logger.info("物体検知AIコントロールを開始します")
        logger.info(f"検知結果は {SAVE_FREQUENCY} フレームに1回保存されます")
        
        # Supabaseストレージのバケットが存在するか確認
        try:
            url = f"{SUPABASE_URL}/storage/v1/bucket/Parking_picture"
            headers = {
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}"
            }
            response = httpx.get(url, headers=headers)
            
            if response.status_code != 200:
                logger.warning("Parking_pictureバケットが存在しない可能性があります。自動的に作成を試みます。")
                
                # バケットを作成
                create_url = f"{SUPABASE_URL}/storage/v1/bucket"
                create_data = {
                    "id": "Parking_picture",
                    "name": "Parking_picture",
                    "public": True
                }
                create_response = httpx.post(create_url, headers=headers, json=create_data)
                
                if create_response.status_code == 200 or create_response.status_code == 201:
                    logger.info("Parking_pictureバケットを作成しました")
                else:
                    logger.error(f"バケット作成エラー: {create_response.status_code} {create_response.text}")
        except Exception as e:
            logger.error(f"バケット確認エラー: {e}")
        
        # 非同期メインループを実行
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("プログラム終了")
        sys.exit(0)
