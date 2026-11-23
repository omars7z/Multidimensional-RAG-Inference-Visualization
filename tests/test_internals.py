import numpy as np

from app.retrieval.internals import fit_3d, place, project_2d


def test_projection_keeps_the_main_spread_and_scales_into_unit_box():
    rng = np.random.default_rng(0)
    points = rng.normal(size=(12, 1024)) * 0.01
    points[:6, 0] += 1  # two clusters along one direction
    xy = project_2d(points)
    assert xy.shape == (12, 2)
    assert np.abs(xy).max() <= 1.0 + 1e-9
    left, right = xy[:6, 0], xy[6:, 0]
    assert (left.max() < right.min()) or (right.max() < left.min())


def test_projection_of_too_few_points_is_the_origin():
    assert project_2d(np.ones((2, 8))).tolist() == [[0, 0], [0, 0]]


def test_3d_fit_spans_the_unit_box_and_places_new_points_on_the_same_axes():
    rng = np.random.default_rng(1)
    points = rng.normal(size=(30, 64))
    fitted = fit_3d(points)
    placed = np.array([place(p, fitted) for p in points])
    assert placed.shape == (30, 3)
    assert np.allclose(np.abs(placed).max(axis=0), 1, atol=1e-3)
    assert place(points.mean(axis=0), fitted) == [0.0, 0.0, 0.0]
