COORDINATE_CONVENTIONS v1.0.0

Global Standard:
- Handedness: Right-handed
- Up: Y+
- X: East(+), West(-)
- Z: South(+), North(-)
- Origin: Center of world grid
- Units: 1 = 1 meter or 1 grid cell

Space Declarations:
- Always declare source and target spaces on transforms.
- Always name matrices used in transformations.

Matrix Trace Example:
vec_ndc = projection * view * model * vec_local

UI Coordinate Display:
X: {x.toFixed(2)} | Y: {y.toFixed(2)} | Z: {z.toFixed(2)}

Verification Checklist:
- [ ] System documented
- [ ] Transform tests pass
- [ ] Visual debug enabled
- [ ] Naming consistent
- [ ] Round-trip verified
