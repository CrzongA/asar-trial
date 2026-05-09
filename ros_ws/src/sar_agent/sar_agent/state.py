from enum import Enum


class AgentState(Enum):
    IDLE = 'IDLE'
    BRIEFING = 'BRIEFING'
    PLANNING = 'PLANNING'
    SEARCHING = 'SEARCHING'
    CONFIRMING = 'CONFIRMING'
    SECURED = 'SECURED'
    ABORTED = 'ABORTED'
    PAUSED = 'PAUSED'
