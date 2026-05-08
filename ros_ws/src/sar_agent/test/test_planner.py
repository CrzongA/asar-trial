import math

from sar_agent.planner import Waypoint, camera_footprint_m, lawn_mower


def test_camera_footprint_grows_with_altitude():
    assert camera_footprint_m(10.0) < camera_footprint_m(20.0)


def test_lawn_mower_covers_disk_and_stays_in_radius():
    home_lat, home_lon = 47.397971, 8.546164
    waypoints = lawn_mower(
        home_lat=home_lat,
        home_lon=home_lon,
        center_lat=home_lat,
        center_lon=home_lon,
        radius_m=50.0,
        altitude_m=15.0,
    )
    assert waypoints, 'expected at least one waypoint'
    for wp in waypoints:
        assert isinstance(wp, Waypoint)
        # Each waypoint must lie within the disk (allow 0.5 m float slack).
        d = math.hypot(wp.east_m, wp.north_m)
        assert d <= 50.0 + 0.5

    # Cover north extent of the disk to within one swath of the edge.
    north_max = max(wp.north_m for wp in waypoints)
    north_min = min(wp.north_m for wp in waypoints)
    assert north_max > 30.0
    assert north_min < -30.0


def test_lawn_mower_rejects_zero_radius():
    try:
        lawn_mower(0.0, 0.0, 0.0, 0.0, radius_m=0.0, altitude_m=10.0)
    except ValueError:
        return
    raise AssertionError('expected ValueError for radius=0')
