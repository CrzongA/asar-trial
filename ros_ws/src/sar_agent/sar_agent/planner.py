"""Lawn-mower waypoint planner over a circular search disk.

Given a center (lat, lon), radius (m), and altitude (m), produce ENU waypoints
(relative to home) that cover the disk in parallel sweeps. Camera footprint is
estimated from a horizontal field-of-view assumption (default 70 deg, matching
PX4's x500_gimbal cam) and the search altitude.
"""

import math
from dataclasses import dataclass


EARTH_R_M = 6378137.0


@dataclass(frozen=True)
class Waypoint:
    east_m: float
    north_m: float
    up_m: float
    lat: float
    lon: float


def _enu_offset(center_lat: float, center_lon: float, target_lat: float, target_lon: float) -> tuple[float, float]:
    north = math.radians(target_lat - center_lat) * EARTH_R_M
    east = math.radians(target_lon - center_lon) * EARTH_R_M * math.cos(math.radians(center_lat))
    return east, north


def _global_offset(home_lat: float, home_lon: float, north_m: float, east_m: float) -> tuple[float, float]:
    lat = home_lat + math.degrees(north_m / EARTH_R_M)
    lon = home_lon + math.degrees(east_m / (EARTH_R_M * math.cos(math.radians(home_lat))))
    return lat, lon


def camera_footprint_m(altitude_m: float, hfov_deg: float = 70.0) -> float:
    """Width of camera footprint on the ground (m) at given altitude."""
    return 2.0 * altitude_m * math.tan(math.radians(hfov_deg / 2.0))


def lawn_mower(
    home_lat: float,
    home_lon: float,
    center_lat: float,
    center_lon: float,
    radius_m: float,
    altitude_m: float,
    *,
    overlap: float = 0.3,
    hfov_deg: float = 70.0,
) -> list[Waypoint]:
    """Generate a lawn-mower scan over the disk centered at (center_lat, center_lon).

    Sweeps run east-west; each pass is offset by `(1 - overlap) * footprint` north.
    Returns waypoints in ENU offsets from home, plus per-waypoint global lat/lon
    so callers can render the path on a map.
    """
    if radius_m <= 0.0:
        raise ValueError('radius_m must be positive')

    footprint = camera_footprint_m(altitude_m, hfov_deg)
    swath = max(footprint * (1.0 - overlap), 1.0)

    east_c, north_c = _enu_offset(home_lat, home_lon, center_lat, center_lon)

    waypoints: list[Waypoint] = []
    n_passes = max(int(math.ceil((2.0 * radius_m) / swath)), 1)
    sweep_dir = 1
    for i in range(n_passes):
        north_offset = -radius_m + (i + 0.5) * swath
        if abs(north_offset) > radius_m:
            continue
        half_chord = math.sqrt(max(radius_m * radius_m - north_offset * north_offset, 0.0))
        if half_chord < 1.0:
            continue
        east_a = east_c - half_chord
        east_b = east_c + half_chord
        north_abs = north_c + north_offset
        if sweep_dir < 0:
            east_a, east_b = east_b, east_a
        for east_abs in (east_a, east_b):
            lat, lon = _global_offset(home_lat, home_lon, north_abs, east_abs)
            waypoints.append(Waypoint(
                east_m=east_abs,
                north_m=north_abs,
                up_m=altitude_m,
                lat=lat,
                lon=lon,
            ))
        sweep_dir *= -1

    return waypoints
