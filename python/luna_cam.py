"""
Luna Camera Bridge — Run inside VS Code to stream your webcam to Luna.

Setup:
  pip install -r requirements.txt
  python luna_cam.py --url wss://YOUR-APP-URL/live

Press 'q' in the preview window to stop.
"""

import argparse
import asyncio
import base64
import json
import sys
import cv2
import websockets


def encode_frame_jpeg(frame, max_width: int = 512, quality: int = 72) -> str:
    h, w = frame.shape[:2]
    if w > max_width:
        scale = max_width / float(w)
        frame = cv2.resize(frame, (max_width, int(h * scale)))
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        return ""
    return base64.b64encode(buf.tobytes()).decode("ascii")


async def stream_camera(ws_url: str, camera_index: int, fps: float) -> None:
    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        print(f"Could not open camera index {camera_index}.", file=sys.stderr)
        return

    print(f"Camera opened. Connecting to {ws_url} ...")
    interval = 1.0 / max(0.2, min(1.0, fps))

    try:
        async with websockets.connect(ws_url) as ws:
            print("Connected to Luna! Start your voice call in the browser.")
            loop = asyncio.get_running_loop()
            started_at = loop.time()
            last_sent = 0.0
            last_gesture_at = 0.0
            prev_gray = None

            while True:
                ok, frame = cap.read()
                if not ok:
                    await asyncio.sleep(0.05)
                    continue

                cv2.imshow("Luna Camera (VS Code) — Press Q to quit", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

                now = loop.time()
                if now - last_sent >= interval:
                    last_sent = now
                    small_gray = cv2.cvtColor(
                        cv2.resize(frame, (48, 36)), cv2.COLOR_BGR2GRAY
                    )
                    gesture_check = False
                    if prev_gray is not None:
                        abs_diff = cv2.absdiff(small_gray, prev_gray)
                        global_score = float(abs_diff.mean()) / 255.0
                        peak_zone = max(
                            float(abs_diff[r * 12 : (r + 1) * 12, c * 12 : (c + 1) * 12].mean()) / 255.0
                            for r in range(3)
                            for c in range(4)
                        )
                        is_gesture = global_score <= 0.38 and (
                            (0.068 <= peak_zone <= 0.48 and global_score >= 0.01)
                            or global_score >= 0.042
                        )
                        if (
                            is_gesture
                            and now - started_at > 1.8
                            and now - last_gesture_at > 6.5
                        ):
                            gesture_check = True
                            last_gesture_at = now
                    prev_gray = small_gray

                    jpg_b64 = encode_frame_jpeg(frame)
                    if jpg_b64:
                        payload = {"video": jpg_b64, "mimeType": "image/jpeg"}
                        if gesture_check:
                            payload["gestureCheck"] = True
                        await ws.send(json.dumps(payload))

                await asyncio.sleep(0.02)
    finally:
        cap.release()
        cv2.destroyAllWindows()


def main() -> None:
    parser = argparse.ArgumentParser(description="Stream webcam frames to Luna")
    parser.add_argument(
        "--url",
        default="ws://localhost:3000/live",
        help="WebSocket /live URL of your Luna app",
    )
    parser.add_argument("--token", default="", help="Optional LUNA_ACCESS_TOKEN")
    parser.add_argument("--camera", type=int, default=0, help="Webcam device index")
    parser.add_argument("--fps", type=float, default=1.0, help="Frames per second (max 1.0)")
    args = parser.parse_args()

    sep = "&" if "?" in args.url else "?"
    ws_url = f"{args.url}{sep}role=camera"
    if args.token:
        ws_url += f"&token={args.token}"

    try:
        asyncio.run(stream_camera(ws_url, args.camera, args.fps))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
