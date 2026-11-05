import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeNativeGroupPose } from '../src/main/services/dat/uisave-pose.ts';

test('GRPPOS distinguishes camera settings, target-relative XYZ and alignment bytes', () => {
  const data = Buffer.alloc(240, 0x7d);
  data[0] = 1;
  data[1] = 2;
  for (const [offset, value] of [
    [4, 3.5],
    [8, 0.75],
    [12, -0.25],
    [16, 1.5],
    [20, -0.5],
    [32, 2.25],
    [48, 1],
    [52, 2],
    [56, 3],
  ])
    data.writeFloatLE(value, offset);
  data[64] = 0;
  const decoded = decodeNativeGroupPose(100, data);
  assert.equal(decoded.cameraZoomMode, 1);
  assert.equal(decoded.cameraControlMode, 2);
  assert.equal(decoded.cameraDistance, 3.5);
  assert.equal(decoded.cameraFieldOfView, 0.75);
  assert.equal(decoded.cameraAngle, -0.25);
  assert.equal(decoded.cameraParameterAt12Raw, -0.25);
  assert.equal(decoded.cameraDirectionHorizontal, 1.5);
  assert.equal(decoded.cameraDirectionVertical, -0.5);
  assert.equal(decoded.cameraYawRadians, 1.5);
  assert.equal(decoded.cameraPitchRadians, -0.5);
  assert.equal(decoded.cameraRotation, 2.25);
  assert.equal(decoded.cameraRotationRadiansRaw, 2.25);
  assert.deepEqual(decoded.cameraPositionOffset, { x: 1, y: 2, z: 3 });
  assert.equal(
    decoded.cameraPositionCoordinateSpace,
    'target-position-relative',
  );
  assert.equal(decoded.isCharacterOrientedCamera, false);
  assert.equal(decoded.cameraPositionCandidate, undefined);
  assert.equal(
    decoded.unknownRanges.find((range) => range.offset === 60).rawHex,
    '7d7d7d7d',
  );
  assert.equal(decoded.rawHex, data.toString('hex'));
  data[64] = 1;
  assert.equal(
    decodeNativeGroupPose(100, data).cameraPositionCoordinateSpace,
    'target-oriented-relative',
  );
});

test('GRPPOS decodes all three light XYZ fields without consuming their fourth words', () => {
  const data = Buffer.alloc(240);
  for (let index = 0; index < 3; index++) {
    const offset = 80 + index * 48;
    data[offset] = 1;
    data.writeFloatLE(index + 0.5, offset + 4);
    data.writeFloatLE(index + 1.5, offset + 8);
    data.writeFloatLE(index + 2.5, offset + 12);
    data.writeUInt32LE(index, offset + 16);
    data.writeFloatLE(10 + index, offset + 32);
    data.writeFloatLE(20 + index, offset + 36);
    data.writeFloatLE(30 + index, offset + 40);
    data.writeUInt32LE(0x7fc00000, offset + 44);
  }
  data[224] = 1;
  data[225] = 1;
  data.writeFloatLE(1.25, 228);
  data[232] = 50;
  const decoded = decodeNativeGroupPose(100, data);
  assert.deepEqual(decoded.lights[2], {
    index: 2,
    offset: 176,
    enabledRaw: 1,
    enabled: true,
    red: 2.5,
    green: 3.5,
    blue: 4.5,
    type: 2,
    position: { x: 12, y: 22, z: 32 },
  });
  assert.equal(decoded.isCharacterOrientedLight, true);
  assert.equal(decoded.isManualBrightnessEnabled, true);
  assert.equal(decoded.manualBrightness, 1.25);
  assert.equal(decoded.characterLighting, 50);
  assert.equal(
    decoded.unknownRanges.find((range) => range.offset === 220).rawHex,
    '0000c07f',
  );
});

test('GRPPOS keeps nonfinite inputs recoverable and rejects unsupported layouts', () => {
  const data = Buffer.alloc(240);
  data.writeFloatLE(Infinity, 48);
  data.writeFloatLE(NaN, 228);
  const decoded = decodeNativeGroupPose(100, data);
  assert.equal(decoded.cameraPositionOffset.x, null);
  assert.equal(decoded.manualBrightness, null);
  assert.equal(decoded.rawHex, data.toString('hex'));
  assert.equal(decodeNativeGroupPose(101, data), null);
  assert.equal(decodeNativeGroupPose(100, Buffer.alloc(239)), null);
  assert.equal(decodeNativeGroupPose(100, Buffer.alloc(241)), null);
});
