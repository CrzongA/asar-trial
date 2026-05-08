"""Tool registry for the SAR agent.

Exposes a small set of callable tools that wrap ROS publishers / service
clients. The same registry can later be wired to vLLM's OpenAI tool-calling
API by emitting `TOOL_SCHEMAS` and dispatching `tool_calls` through `dispatch`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


# OpenAI tool schema descriptors. Hand to vLLM as `tools=[...]` when the
# planner is upgraded to a VLM-driven agent loop.
TOOL_SCHEMAS = [
    {
        'type': 'function',
        'function': {
            'name': 'goto_waypoint',
            'description': 'Fly to a global lat/lon/altitude waypoint.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'lat': {'type': 'number'},
                    'lon': {'type': 'number'},
                    'altitude_m': {'type': 'number'},
                },
                'required': ['lat', 'lon', 'altitude_m'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'set_gimbal',
            'description': 'Slew the gimbal to absolute pitch/yaw angles in radians.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'pitch_rad': {'type': 'number'},
                    'yaw_rad': {'type': 'number'},
                },
                'required': ['pitch_rad', 'yaw_rad'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'record_target_status',
            'description': 'Record a confirmed target status with the mission manager.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'found': {'type': 'boolean'},
                    'health': {'type': 'string'},
                    'terrain': {'type': 'string'},
                    'distance_to_safety_m': {'type': 'number'},
                    'lat': {'type': 'number'},
                    'lon': {'type': 'number'},
                    'altitude_m': {'type': 'number'},
                    'confidence': {'type': 'number'},
                    'rationale': {'type': 'string'},
                },
                'required': ['found', 'lat', 'lon'],
            },
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'cancel_mission',
            'description': 'Abort the current search and hold position.',
            'parameters': {'type': 'object', 'properties': {}},
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'land',
            'description': 'Trigger an automatic landing at the current position.',
            'parameters': {'type': 'object', 'properties': {}},
        },
    },
    {
        'type': 'function',
        'function': {
            'name': 'report_progress',
            'description': 'Push a free-form status note to the agent log.',
            'parameters': {
                'type': 'object',
                'properties': {'message': {'type': 'string'}},
                'required': ['message'],
            },
        },
    },
]


@dataclass
class Tool:
    name: str
    fn: Callable[..., Any]


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, name: str, fn: Callable[..., Any]) -> None:
        self._tools[name] = Tool(name=name, fn=fn)

    def dispatch(self, name: str, **kwargs: Any) -> Any:
        if name not in self._tools:
            raise KeyError(f'Unknown tool: {name}')
        return self._tools[name].fn(**kwargs)

    def names(self) -> list[str]:
        return list(self._tools.keys())
