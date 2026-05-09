#!/usr/bin/env python3
"""
ASAR Agent Log Monitor
Subscribes to /sar/agent_log and prints formatted events to the terminal.
"""

import json
import rclpy
from rclpy.node import Node
from std_msgs.msg import String
from datetime import datetime

# ANSI Color codes
COLORS = {
    'info': '\033[94m',      # Blue
    'state': '\033[96m',     # Cyan
    'tool_call': '\033[92m',  # Green
    'tool_result': '\033[92m',# Green
    'vlm_reason': '\033[95m', # Purple
    'detection': '\033[91m',  # Red
    'error': '\033[93m',      # Yellow/Amber
    'action': '\033[32m',     # Dark Green
    'paused': '\033[33m',     # Amber
    'reset': '\033[0m'
}

class LogMonitor(Node):
    def __init__(self):
        super().__init__('log_monitor')
        self.subscription = self.create_subscription(
            String,
            '/sar/agent_log',
            self.listener_callback,
            10)
        print(f"{COLORS['info']}Connected to /sar/agent_log. Monitoring...{COLORS['reset']}\n")

    def listener_callback(self, msg):
        try:
            entry = json.loads(msg.data)
            ts = datetime.fromtimestamp(entry.get('ts', 0)).strftime('%H:%M:%S')
            kind = entry.get('kind', 'info')
            state = entry.get('state', 'IDLE')
            data = entry.get('data', {})

            color = COLORS.get(kind, COLORS['reset'])
            
            # Format the headline
            headline = ""
            if 'msg' in data:
                headline = str(data['msg'])
            elif kind == 'tool_call' and 'tool' in data:
                headline = f"tool {data['tool']}"
            elif kind == 'detection' and 'label' in data:
                headline = f"{data['label']} (conf {data.get('confidence', 0):.2f})"
            elif kind == 'vlm_reason' and 'rationale' in data:
                headline = str(data['rationale'])
            else:
                headline = json.dumps(data)

            print(f"[{ts}] {COLORS['state']}{state:10}{COLORS['reset']} | {color}{kind.upper():12}{COLORS['reset']} | {color}{headline}{COLORS['reset']}")
            
            # If it's a multi-line detail, or we want to see the full JSON on some types
            if kind in ('error', 'vlm_reason') and 'msg' not in data:
                print(f"      {json.dumps(data, indent=2)}")

        except Exception as e:
            print(f"Error parsing log: {e} | Raw: {msg.data}")

def main(args=None):
    rclpy.init(args=args)
    monitor = LogMonitor()
    try:
        rclpy.spin(monitor)
    except KeyboardInterrupt:
        pass
    finally:
        monitor.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()
