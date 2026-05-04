import asyncio
import cv2
import threading
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image
from cv_bridge import CvBridge
from rclpy.qos import qos_profile_sensor_data
from aiohttp import web
import numpy as np

class MJPEGNode(Node):
    def __init__(self):
        super().__init__('mjpeg_streamer')
        self.bridge = CvBridge()
        self.latest_frame = None
        self.subscription = self.create_subscription(
            Image,
            '/camera/image_raw',
            self.image_callback,
            qos_profile_sensor_data
        )
        self.get_logger().info('MJPEG Streamer Node Started. Subscribed to /camera/image_raw')

    def image_callback(self, msg):
        try:
            cv_image = self.bridge.imgmsg_to_cv2(msg, desired_encoding='bgr8')
            _, buffer = cv2.imencode('.jpg', cv_image)
            self.latest_frame = buffer.tobytes()
        except Exception as e:
            self.get_logger().error(f"CV Bridge Error: {e}")

ros_node = None

async def mjpeg_handler(request):
    response = web.StreamResponse(
        status=200,
        reason='OK',
        headers={
            'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
            'Access-Control-Allow-Origin': '*'
        }
    )
    await response.prepare(request)

    while True:
        if ros_node and ros_node.latest_frame:
            frame = ros_node.latest_frame
            await response.write(b'--frame\r\n')
            await response.write(b'Content-Type: image/jpeg\r\n\r\n')
            await response.write(frame)
            await response.write(b'\r\n')
        else:
            # Send blank frame if no data
            blank = np.zeros((480, 640, 3), dtype=np.uint8)
            _, buffer = cv2.imencode('.jpg', blank)
            await response.write(b'--frame\r\n')
            await response.write(b'Content-Type: image/jpeg\r\n\r\n')
            await response.write(buffer.tobytes())
            await response.write(b'\r\n')
        
        await asyncio.sleep(0.05) # 20 FPS max

async def snapshot_handler(request):
    if ros_node and ros_node.latest_frame:
        return web.Response(body=ros_node.latest_frame, content_type='image/jpeg')
    else:
        blank = np.zeros((480, 640, 3), dtype=np.uint8)
        _, buffer = cv2.imencode('.jpg', blank)
        return web.Response(body=buffer.tobytes(), content_type='image/jpeg')

def run_ros_node(args=None):
    global ros_node
    rclpy.init(args=args)
    ros_node = MJPEGNode()
    rclpy.spin(ros_node)
    ros_node.destroy_node()
    rclpy.shutdown()

if __name__ == "__main__":
    ros_thread = threading.Thread(target=run_ros_node, daemon=True)
    ros_thread.start()

    app = web.Application()
    app.router.add_get('/video', mjpeg_handler)
    app.router.add_get('/snapshot', snapshot_handler)
    
    print("Starting streaming server on http://0.0.0.0:8080")
    web.run_app(app, host="0.0.0.0", port=8080)
