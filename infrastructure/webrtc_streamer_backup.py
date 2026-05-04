import asyncio
import json
import threading
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image
from cv_bridge import CvBridge
from rclpy.qos import qos_profile_sensor_data
from aiohttp import web
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack
from av import VideoFrame
import numpy as np

class ROSVideoTrack(VideoStreamTrack):
    def __init__(self):
        super().__init__()
        self.img_msg = None
        self.bridge = CvBridge()
        self._timestamp = 0

    def update_image(self, msg):
        self.img_msg = msg

    async def recv(self):
        pts, time_base = await self.next_timestamp()
        
        if self.img_msg is None:
            # Send a blank frame if no ROS image is received yet
            img = np.zeros((480, 640, 3), dtype=np.uint8)
        else:
            try:
                # Convert ROS Image to OpenCV format
                img = self.bridge.imgmsg_to_cv2(self.img_msg, desired_encoding="rgb8")
            except Exception as e:
                print(f"CV Bridge Error: {e}")
                img = np.zeros((480, 640, 3), dtype=np.uint8)

        # Create pyAV VideoFrame
        frame = VideoFrame.from_ndarray(img, format="rgb24")
        frame.pts = pts
        frame.time_base = time_base
        return frame

class WebRTCNode(Node):
    def __init__(self, track):
        super().__init__('webrtc_streamer_backup')
        self.track = track
        self.subscription = self.create_subscription(
            Image,
            '/camera/image_raw',
            self.image_callback,
            qos_profile_sensor_data
        )
        self.get_logger().info('WebRTC Streamer ROS 2 Node Started. Subscribed to /camera/image_raw')

    def image_callback(self, msg):
        self.track.update_image(msg)

pcs = set()
video_track = ROSVideoTrack()

async def offer(request):
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

    pc = RTCPeerConnection()
    pcs.add(pc)

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        print("Connection state is %s" % pc.connectionState)
        if pc.connectionState == "failed" or pc.connectionState == "closed":
            pcs.discard(pc)

    # Add the ROS video track
    pc.addTrack(video_track)

    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }

    if request.method == "OPTIONS":
        return web.Response(headers=headers)

    return web.Response(
        content_type="application/json",
        headers=headers,
        text=json.dumps(
            {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}
        ),
    )

async def options_handler(request):
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }
    return web.Response(headers=headers)

async def on_shutdown(app):
    coros = [pc.close() for pc in pcs]
    await asyncio.gather(*coros)
    pcs.clear()

def run_ros_node(args=None):
    rclpy.init(args=args)
    node = WebRTCNode(video_track)
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()

if __name__ == "__main__":
    # Start ROS 2 node in a separate thread
    ros_thread = threading.Thread(target=run_ros_node, daemon=True)
    ros_thread.start()

    # Start the aiohttp WebRTC signaling server
    app = web.Application()
    app.on_shutdown.append(on_shutdown)
    
    app.router.add_post("/offer", offer)
    app.router.add_options("/offer", options_handler)

    print("Starting WebRTC signaling server on http://0.0.0.0:8080")
    web.run_app(app, host="0.0.0.0", port=8080)
