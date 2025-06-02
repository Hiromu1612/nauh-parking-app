# detector_realtime.py
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
import uuid
from datetime import datetime, timezone
from dotenv import load_dotenv
from ultralytics import YOLO
from ultralytics.solutions import ParkingManagement

# --- ロギング設定 ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
logging.getLogger('websockets.protocol').setLevel(logging.WARNING)
logging.getLogger('httpx').setLevel(logging.WARNING)
logging.getLogger('supabase').setLevel(logging.WARNING)
logging.getLogger('gotrue').setLevel(logging.WARNING)

# --- 環境変数読み込み ---
load_dotenv()
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_ANON_KEY') # Anon key (public)
PARKING_LOT_ID = os.getenv('PARKING_LOT_ID')
CAMERA_SECRET_KEY = os.getenv('CAMERA_SECRET_KEY')

VIDEO_SOURCE = os.getenv('VIDEO_SOURCE', "0") # デフォルトは0番カメラ
REGIONS_FILE_PATH = os.getenv('REGIONS_FILE_PATH', "regions.json")
MODEL_PATH = os.getenv('MODEL_PATH', "yolov8n.pt") # より軽量なモデルをデフォルトに

if not all([SUPABASE_URL, SUPABASE_KEY, PARKING_LOT_ID, CAMERA_SECRET_KEY]):
    logger.error("必要な環境変数 (SUPABASE_URL, SUPABASE_ANON_KEY, PARKING_LOT_ID, CAMERA_SECRET_KEY) が未設定です。")
    sys.exit(1)

# --- グローバル変数 ---
REALTIME_URL = f"wss://{SUPABASE_URL.replace('https://', '')}/realtime/v1/websocket?apikey={SUPABASE_KEY}&vsn=1.0.0"
CHANNEL_NAME = f"realtime:parking-control-{PARKING_LOT_ID}" # 駐車場IDに基づいて動的に設定
STORAGE_BUCKET_NAME = "Parking_picture"

ws_connection = None
channel_joined = False
connection_event = asyncio.Event()
command_event = asyncio.Event() # コマンド受信通知用

current_session_id = None
SAVE_FREQUENCY = 5  # 5フレームに1回保存

class ProgramState:
    def __init__(self):
        self.running = False
        self.stop_event = threading.Event() # 検知ループ停止用
        self.connected_to_realtime = False

    def stop_detection(self):
        logger.info("検知停止コマンド受信または内部停止要求")
        self.running = False
        self.stop_event.set()

    def start_detection(self):
        logger.info("検知開始コマンド受信")
        self.running = True
        self.stop_event.clear()

    def is_detection_running(self):
        return self.running

    def set_realtime_connected(self, status):
        self.connected_to_realtime = status

    def is_realtime_connected(self):
        return self.connected_to_realtime

program_state = ProgramState()

# --- Supabase連携関数 ---
def supabase_request(method, path, data=None, content=None, content_type="application/json"):
    try:
        url = f"{SUPABASE_URL}{path}"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": content_type,
        }
        if method.upper() in ["POST", "PATCH"] and content_type == "application/json":
            headers["Prefer"] = "return=representation"

        logger.debug(f"Supabase Request: {method.upper()} {url} Data: {data}")
        
        with httpx.Client(timeout=20.0) as client:
            if method.upper() == "POST":
                response = client.post(url, headers=headers, json=data)
            elif method.upper() == "PUT":
                 response = client.put(url, headers=headers, content=content)
            elif method.upper() == "GET":
                response = client.get(url, headers=headers)
            else:
                logger.error(f"Unsupported HTTP method: {method}")
                return None

        logger.debug(f"Supabase Response: {response.status_code} {response.text[:200]}")
        response.raise_for_status()
        
        return response.json() if response.text and response.status_code != 204 else True
    except httpx.HTTPStatusError as e:
        error_message = e.response.text[:500]
        logger.error(f"Supabase HTTPエラー ({path}): {e.response.status_code} - {error_message}")
        if "security policy" in error_message or "RLS" in error_message:
            logger.error("RLSポリシー違反の可能性があります。SupabaseダッシュボードでテーブルのRLS設定を確認してください。")
    except httpx.RequestError as e:
        logger.error(f"Supabaseリクエストエラー ({path}): {e}")
    except Exception as e:
        logger.error(f"Supabase連携中の予期せぬエラー ({path}): {e}")
    return None

def upload_frame_to_storage(frame_bytes, file_name_in_storage):
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    full_storage_path = f"{PARKING_LOT_ID}/{date_str}/{file_name_in_storage}"
    path = f"/storage/v1/object/{STORAGE_BUCKET_NAME}/{full_storage_path}"
    
    result = supabase_request("PUT", path, content=frame_bytes, content_type="image/jpeg")
    if result:
        return f"{SUPABASE_URL}/storage/v1/object/public/{STORAGE_BUCKET_NAME}/{full_storage_path}"
    return None


def insert_detection_result(session_id, frame_path, stats, frame_count_val):
    path = "/rest/v1/detection_results"
    data = {
        "session_id": session_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "frame_path": frame_path,
        "total_occupied_spaces": stats.get("total_occupied_spaces", 0),
        "total_empty_spaces": stats.get("total_empty_spaces", 0),
        "total_cars": stats.get("total_cars", 0),
        "total_large_cars": stats.get("total_large_cars", 0),
        "frame_count": frame_count_val
    }
    result = supabase_request("POST", path, data=data)
    return result[0]['id'] if result and isinstance(result, list) and len(result) > 0 and 'id' in result[0] else None


def insert_space_statuses(result_id, parking_lot_status):
    path = "/rest/v1/space_statuses"
    records = []
    for space_info in parking_lot_status:  # .items()ではなく直接イテレート
        records.append({
            "result_id": result_id,
            "space_id": space_info.get("space_id"), 
            "status": space_info.get("status", "unknown"),
            "duration": space_info.get("duration_seconds", 0),
            "vehicle_type": space_info.get("vehicle_type", None)
        })
    if records:
        return supabase_request("POST", path, data=records)
    return True

# --- WebSocket通信 ---
async def send_realtime_message(event_type, payload_data):
    if ws_connection and ws_connection.protocol.state == websockets.protocol.State.OPEN and channel_joined:
        try:
            message = {
                "topic": CHANNEL_NAME,
                "event": event_type,
                "payload": payload_data,
                "ref": str(uuid.uuid4())
            }
            await ws_connection.send(json.dumps(message))
            logger.info(f"メッセージ送信 ({event_type}): {payload_data}")
            return True
        except Exception as e:
            logger.error(f"メッセージ送信エラー: {e}")
    return False

async def notify_status_to_frontend(status_str):
    payload_for_frontend = {
        "type": "broadcast",
        "event": "status",
        "payload": {
            "status": status_str,
            "session_id": current_session_id,
            "parking_lot_id": PARKING_LOT_ID
        }
    }
    await send_realtime_message("broadcast", payload_for_frontend)


async def handle_realtime_message(message_str):
    global channel_joined, current_session_id
    try:
        data = json.loads(message_str)
        event = data.get("event")
        payload = data.get("payload", {})
        topic = data.get("topic")

        if event == "phx_reply" and payload.get("status") == "ok" and topic == CHANNEL_NAME:
            if not channel_joined:
                channel_joined = True
                program_state.set_realtime_connected(True)
                connection_event.set()
                logger.info(f"チャンネル '{CHANNEL_NAME}' に参加しました。")
                await notify_status_to_frontend("stopped")
            elif data.get("ref") and "heartbeat" in data.get("ref", ""):
                 logger.debug("ハートビート応答受信")

        elif event == "broadcast" and topic == CHANNEL_NAME:
            inner_payload = payload.get("payload", {})
            command = inner_payload.get("command")
            received_parking_lot_id = inner_payload.get("parking_lot_id")
            received_secret_key = inner_payload.get("camera_secret_key")
            session_id_from_command = inner_payload.get("session_id")

            logger.info(f"受信コマンド: {command}, PL_ID: {received_parking_lot_id}, Session: {session_id_from_command}")

            if command and received_parking_lot_id == PARKING_LOT_ID and received_secret_key == CAMERA_SECRET_KEY:
                if command == "start":
                    if session_id_from_command:
                        current_session_id = session_id_from_command
                        if not program_state.is_detection_running():
                            program_state.start_detection()
                            command_event.set()
                        await notify_status_to_frontend("running")
                    else:
                        logger.warning("開始コマンドにセッションIDが含まれていません。")
                elif command == "stop":
                    if program_state.is_detection_running():
                        program_state.stop_detection()
                    await notify_status_to_frontend("stopped")
            elif command:
                logger.warning(f"不正なコマンド受信: IDまたはキー不一致。 Recv_PL_ID: {received_parking_lot_id}, Expected_PL_ID: {PARKING_LOT_ID}, Recv_Key: {received_secret_key}, Expected_Key: {CAMERA_SECRET_KEY}")

    except json.JSONDecodeError:
        logger.error(f"JSONデコードエラー: {message_str}")
    except Exception as e:
        logger.error(f"メッセージ処理エラー: {e} (メッセージ: {message_str})")


async def realtime_client_loop():
    global ws_connection, channel_joined
    while True:
        try:
            logger.info(f"Supabase Realtime ({CHANNEL_NAME}) に接続試行中...")
            async with websockets.connect(REALTIME_URL, ping_interval=25, ping_timeout=30) as websocket:
                ws_connection = websocket
                channel_joined = False

                join_req_id = str(uuid.uuid4())
                join_message = {
                    "topic": CHANNEL_NAME,
                    "event": "phx_join",
                    "payload": {},
                    "ref": join_req_id
                }
                await websocket.send(json.dumps(join_message))
                logger.info(f"チャンネル参加要求送信 (ref: {join_req_id})")

                async def send_heartbeat():
                    hb_ref_counter = 0
                    while True:
                        await asyncio.sleep(25)
                        if ws_connection and ws_connection.protocol.state == websockets.protocol.State.OPEN:
                            hb_ref = f"heartbeat:{hb_ref_counter}"
                            hb_msg = {"topic": "phoenix", "event": "heartbeat", "payload": {}, "ref": hb_ref}
                            await ws_connection.send(json.dumps(hb_msg))
                            logger.debug(f"ハートビート送信 (ref: {hb_ref})")
                            hb_ref_counter += 1
                        else:
                            break
                
                heartbeat_task = asyncio.create_task(send_heartbeat())
                async for message_str in websocket:
                    await handle_realtime_message(message_str)
                heartbeat_task.cancel()
        except websockets.exceptions.ConnectionClosed as e:
            logger.warning(f"WebSocket接続が閉じられました: {e}. 再接続試行...")
        except Exception as e:
            logger.error(f"WebSocketクライアントエラー: {e}. 再接続試行...")
        finally:
            ws_connection = None
            channel_joined = False
            program_state.set_realtime_connected(False)
            connection_event.clear()
            await asyncio.sleep(5)

# --- 物体検知処理 ---
def parking_detection_loop(main_event_loop):
    global current_session_id
    logger.info(f"物体検知ループ開始 (セッションID: {current_session_id})")
    logger.info(f"環境変数 VIDEO_SOURCE の値: '{VIDEO_SOURCE}'")

    cap = None
    video_source_opened = False
    
    # 最初にVIDEO_SOURCEで指定されたソースを試す
    primary_source_to_try = VIDEO_SOURCE
    logger.info(f"プライマリビデオソース '{primary_source_to_try}' を開こうとしています...")
    try:
        # 数値ならカメラID、そうでなければファイルパスとして解釈
        processed_primary_source = int(primary_source_to_try) if primary_source_to_try.isdigit() else primary_source_to_try
        cap = cv2.VideoCapture(processed_primary_source)
        if cap.isOpened():
            video_source_opened = True
            logger.info(f"プライマリビデオソース '{processed_primary_source}' のオープンに成功しました。")
        else:
            logger.warning(f"プライマリビデオソース '{processed_primary_source}' を開けませんでした。")
    except Exception as e:
        logger.error(f"プライマリビデオソース '{primary_source_to_try}' のオープン中にエラー: {e}")

    # プライマリソースが開けず、かつそれがファイル指定だった場合、Webカメラ(0)を試す
    if not video_source_opened and not VIDEO_SOURCE.isdigit():
        fallback_source_to_try = 0 # デフォルトWebカメラ
        logger.info(f"動画ファイルの読み込みに失敗したため、フォールバックとしてWebカメラ '{fallback_source_to_try}' を試します...")
        try:
            cap = cv2.VideoCapture(fallback_source_to_try)
            if cap.isOpened():
                video_source_opened = True
                logger.info(f"フォールバックWebカメラ '{fallback_source_to_try}' のオープンに成功しました。")
            else:
                logger.error(f"フォールバックWebカメラ '{fallback_source_to_try}' も開けませんでした。")
        except Exception as e:
            logger.error(f"フォールバックWebカメラ '{fallback_source_to_try}' のオープン中にエラー: {e}")
    
    if not video_source_opened:
        final_attempted_source_log = f"プライマリ: '{VIDEO_SOURCE}'"
        if not VIDEO_SOURCE.isdigit():
            final_attempted_source_log += f", フォールバック: '0'"
        logger.error(f"最終的にビデオソースを開けませんでした。試行したソース -> {final_attempted_source_log}")
        program_state.stop_detection()
        if main_event_loop.is_running():
            asyncio.run_coroutine_threadsafe(notify_status_to_frontend("error_video_source"), main_event_loop)
        return

    try:
        model = YOLO(MODEL_PATH)
        
        if not os.path.exists(REGIONS_FILE_PATH):
            logger.error(f"領域定義ファイルが見つかりません: {REGIONS_FILE_PATH}")
            program_state.stop_detection()
            if main_event_loop.is_running():
                asyncio.run_coroutine_threadsafe(notify_status_to_frontend("error_regions_file"), main_event_loop)
            if cap and cap.isOpened(): cap.release()
            return

        parking_manager = ParkingManagement(
            model=model,
            json_file=REGIONS_FILE_PATH,
        )
        logger.info("ParkingManagement初期化完了")

        frame_counter = 0
        while cap.isOpened() and not program_state.stop_event.is_set():
            ret, frame = cap.read()
            if not ret:
                logger.info("ビデオストリームの終端または読み取りエラー。")
                break
            
            processed_frame, json_results_str = parking_manager.process_data(frame.copy())
            
            try:
                parking_stats_from_ultralytics = json.loads(json_results_str)
                current_total_cars = 0
                current_total_large_cars = 0
                if "parking_lot_status" in parking_stats_from_ultralytics:
                    for space_info in parking_stats_from_ultralytics["parking_lot_status"]:  # .values()を削除
                        if space_info.get("status") == "occupied":
                            if space_info.get("vehicle_type") == "car": 
                                current_total_cars +=1
                            elif space_info.get("vehicle_type") == "large_car":
                                current_total_large_cars +=1
                
                db_stats = {
                    "total_occupied_spaces": parking_stats_from_ultralytics.get("total_occupied_spaces", 0),
                    "total_empty_spaces": parking_stats_from_ultralytics.get("total_empty_spaces", 0),
                    "total_cars": current_total_cars,
                    "total_large_cars": current_total_large_cars,
                }

            except json.JSONDecodeError:
                logger.error(f"検知結果JSONのパース失敗: {json_results_str}")
                db_stats = {}
                parking_stats_from_ultralytics = {"parking_lot_status": {}}


            if frame_counter % SAVE_FREQUENCY == 0:
                # 新しい形式のファイル名を生成
                timestamp_filename = datetime.now(timezone.utc).strftime("%H_%M_%S")
                image_file_name = f"{timestamp_filename}.jpg"
                
                _, img_encoded = cv2.imencode(".jpg", processed_frame)
                frame_bytes = img_encoded.tobytes()

                public_frame_url = upload_frame_to_storage(frame_bytes, image_file_name)
                
                if public_frame_url:
                    result_id = insert_detection_result(current_session_id, public_frame_url, db_stats, frame_counter)
                    if result_id and "parking_lot_status" in parking_stats_from_ultralytics:
                        insert_space_statuses(result_id, parking_stats_from_ultralytics["parking_lot_status"])
                        logger.info(f"フレーム {frame_counter}: 検知結果保存完了 (Result ID: {result_id})")
                    elif result_id:
                         logger.info(f"フレーム {frame_counter}: 検知結果ヘッダー保存完了 (Result ID: {result_id})、スペース情報なし")
                    else:
                        logger.error(f"フレーム {frame_counter}: 検知結果のDB保存失敗")
                else:
                    logger.error(f"フレーム {frame_counter}: 画像アップロード失敗のためDB保存スキップ")
            
            frame_counter += 1

    except Exception as e:
        logger.error(f"物体検知ループでエラー発生: {e}", exc_info=True)
    finally:
        if cap and cap.isOpened():
            cap.release()
        logger.info(f"物体検知ループ終了 (セッションID: {current_session_id})")
        program_state.stop_detection()
        if main_event_loop.is_running():
            asyncio.run_coroutine_threadsafe(notify_status_to_frontend("stopped"), main_event_loop)
        else:
            logger.warning("メインイベントループが実行中でないため、最終ステータス通知をスキップ")

# --- メイン制御 ---
async def main_control_loop():
    global current_session_id
    detection_thread = None

    logger.info("メイン制御ループ開始。Realtime接続待機中...")
    await connection_event.wait()
    logger.info("Realtime接続確立。コマンド待機中...")

    while True:
        await command_event.wait()
        command_event.clear()

        if program_state.is_detection_running():
            if detection_thread is None or not detection_thread.is_alive():
                logger.info(f"検知スレッド開始 (セッションID: {current_session_id})")
                program_state.stop_event.clear()
                current_loop = asyncio.get_running_loop()
                detection_thread = threading.Thread(target=parking_detection_loop, args=(current_loop,), daemon=True)
                detection_thread.start()
            else:
                logger.info("検知スレッドは既に実行中です。")
        else: 
            if detection_thread and detection_thread.is_alive():
                logger.info("検知スレッドに停止を要求し、終了を待機します...")
                program_state.stop_event.set()
                detection_thread.join(timeout=10)
                if detection_thread.is_alive():
                    logger.warning("検知スレッドがタイムアウト後も終了しませんでした。")
                else:
                    logger.info("検知スレッド正常終了。")
                detection_thread = None
            else:
                logger.info("検知スレッドは実行されていませんでした。")


def signal_handler_fn(sig, frame):
    logger.info("プログラム終了要求受信 (Ctrl+C)")
    program_state.stop_detection()
    
    loop = None
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("シグナルハンドラ実行時にアクティブなイベントループが見つかりません。")

    if loop and loop.is_running():
        if ws_connection and ws_connection.protocol.state == websockets.protocol.State.OPEN:
            asyncio.run_coroutine_threadsafe(notify_status_to_frontend("stopped"), loop)
            asyncio.run_coroutine_threadsafe(ws_connection.close(), loop)
    else:
        logger.warning("イベントループが利用できず、クリーンシャットダウンメッセージ送信失敗。")

    active_threads = threading.enumerate()
    for t in active_threads:
        if t is not threading.main_thread() and t.is_alive():
            try:
                if hasattr(t, 'stop_event') and isinstance(t.stop_event, threading.Event):
                    t.stop_event.set()
                t.join(timeout=2)
            except Exception as e:
                logger.warning(f"スレッド {t.name} の終了中にエラー: {e}")
    sys.exit(0)

if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal_handler_fn)
    signal.signal(signal.SIGTERM, signal_handler_fn)

    bucket_check_result = supabase_request("GET", f"/storage/v1/bucket/{STORAGE_BUCKET_NAME}")
    if not bucket_check_result or (isinstance(bucket_check_result, dict) and bucket_check_result.get('error')):
        logger.warning(f"ストレージバケット '{STORAGE_BUCKET_NAME}' が存在しないかアクセスできません。")
        logger.error(f"Supabaseダッシュボードで '{STORAGE_BUCKET_NAME}' バケットがPublicで存在し、適切なRLSポリシーが設定されていることを確認してください。")
        logger.warning(f"バケット '{STORAGE_BUCKET_NAME}' の確認に失敗しました。処理を続行しますが、画像アップロードでエラーが発生する可能性があります。")

    loop = asyncio.get_event_loop()
    try:
        logger.info("駐車場満空検知AIを起動します...")
        loop.run_until_complete(asyncio.gather(
            realtime_client_loop(),
            main_control_loop()
        ))
    except KeyboardInterrupt:
        logger.info("プログラムが中断されました。")
    except Exception as e:
        logger.error(f"メイン実行中に予期せぬエラー: {e}", exc_info=True)
    finally:
        logger.info("プログラム終了処理中...")
        for task in asyncio.all_tasks(loop):
            task.cancel()
        loop.close()
        logger.info("プログラム終了。")