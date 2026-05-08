# Briefing handed to the SAR agent. Either target_description or clue_image
# (or both) must be populated; the agent uses the VLM to derive a textual
# target description from clue_image when the description field is empty.

string target_description
sensor_msgs/Image clue_image

float64 search_center_lat
float64 search_center_lon
float32 search_radius_m
float32 search_altitude_m
