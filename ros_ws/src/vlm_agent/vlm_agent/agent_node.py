import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image
from std_msgs.msg import String

class AgentNode(Node):
    def __init__(self):
        super().__init__('vlm_agent_node')
        self.get_logger().info('VLM Agent Node started.')
        self.subscription = self.create_subscription(
            Image,
            '/camera/image_raw',
            self.image_callback,
            10)
        self.publisher = self.create_publisher(String, '/vlm/target_detections', 10)
        
    def image_callback(self, msg):
        # In a real scenario, this would send the image to the vLLM REST API
        # and parse the semantic matching response.
        self.get_logger().debug('Received image frame.')
        
        # Mock detection
        mock_detection = String()
        mock_detection.data = '{"target": "person wearing a red jacket", "bbox": [100, 150, 200, 300], "confidence": 0.95}'
        self.publisher.publish(mock_detection)

def main(args=None):
    rclpy.init(args=args)
    agent_node = AgentNode()
    rclpy.spin(agent_node)
    agent_node.destroy_node()
    rclpy.shutdown()

if __name__ == '__main__':
    main()
