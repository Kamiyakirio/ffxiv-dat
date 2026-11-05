// Static target: ffxiv_dx11.exe SHA-256
// 958b78e278ad896493c484eb313ff605ab41edefef74f92b0ee078e69b281bf9.
// Writer 0x1408099c0 serializes 240 bytes at module+0x50; reader 0x140809a00.
// Camera save 0x140809aa0, UI restore 0x14100a8f8..0x14100a971, snapshot
// capture/apply 0x1418abb90 / 0x1418abcc0 establish the field correspondence.
// XYZ are a relative camera offset: capture subtracts target position, or
// 0x14089bd30 transforms into target orientation; apply reverses these via
// addition / 0x14089bc80. Only XYZ are copied, not a fourth vector component.
// Light save 0x140809b20 likewise copies three position components per light.

function finiteFloat(data: Buffer, offset: number): number | null {
  const value = data.readFloatLE(offset);
  return Number.isFinite(value) ? value : null;
}

/** Decode the unmasked v100 GRPPOS record without treating alignment as W. */
export function decodeNativeGroupPose(
  version: number,
  data: Buffer,
): Record<string, unknown> | null {
  if (version !== 100 || data.length !== 240) return null;
  const vector = (offset: number) => ({
    x: finiteFloat(data, offset),
    y: finiteFloat(data, offset + 4),
    z: finiteFloat(data, offset + 8),
  });
  const ranges = [
    [2, 2],
    [24, 8],
    [36, 12],
    [60, 4],
    [65, 15],
    ...Array.from({ length: 3 }, (_, index) => {
      const offset = 80 + index * 48;
      return [
        [offset + 1, 3],
        [offset + 20, 12],
        [offset + 44, 4],
      ];
    }).flat(),
    [226, 2],
    [233, 7],
  ];
  return {
    layoutBasis:
      'target v100 240-byte native camera/lighting snapshot; camera and light XYZ copied individually',
    offsetBasis: 'relative to this decoded segment',
    cameraZoomMode: data[0],
    cameraControlMode: data[1],
    cameraDistance: finiteFloat(data, 4),
    cameraFieldOfView: finiteFloat(data, 8),
    // Legacy names from GroupPoseModule remain aliases, not extra evidence
    // of their business meanings. Native Camera+0x13c is still unnamed.
    cameraParameterAt12Raw: finiteFloat(data, 12),
    cameraAngle: finiteFloat(data, 12),
    cameraDirectionHorizontal: finiteFloat(data, 16),
    cameraDirectionVertical: finiteFloat(data, 20),
    cameraYawRadians: finiteFloat(data, 16),
    cameraPitchRadians: finiteFloat(data, 20),
    cameraParameterAt24Raw: finiteFloat(data, 24),
    cameraParameterAt28Raw: finiteFloat(data, 28),
    // Apply clamps this parameter to +/- PI, then writes Camera+0x170/+0xf8.
    // Its exact axis is not inferred from those stores alone.
    cameraRotationRadiansRaw: finiteFloat(data, 32),
    cameraRotation: finiteFloat(data, 32),
    cameraPositionOffset: vector(48),
    cameraPositionCoordinateSpace:
      data[64] === 0 ? 'target-position-relative' : 'target-oriented-relative',
    isCharacterOrientedCameraRaw: data[64],
    isCharacterOrientedCamera: data[64] !== 0,
    lights: Array.from({ length: 3 }, (_, index) => {
      const offset = 80 + index * 48;
      return {
        index,
        offset,
        enabledRaw: data[offset],
        enabled: data[offset] !== 0,
        red: finiteFloat(data, offset + 4),
        green: finiteFloat(data, offset + 8),
        blue: finiteFloat(data, offset + 12),
        type: data.readUInt32LE(offset + 16),
        position: vector(offset + 32),
      };
    }),
    isCharacterOrientedLightRaw: data[224],
    isCharacterOrientedLight: data[224] !== 0,
    isManualBrightnessEnabledRaw: data[225],
    isManualBrightnessEnabled: data[225] !== 0,
    manualBrightness: finiteFloat(data, 228),
    characterLighting: data[232],
    unknownRanges: ranges.map(([offset, byteLength]) => ({
      offset,
      byteLength,
      rawHex: data.subarray(offset, offset + byteLength).toString('hex'),
    })),
    rawHex: data.toString('hex'),
    coverage: {
      structureComplete: true,
      knownFields: [
        'cameraZoomMode',
        'cameraControlMode',
        'cameraDistance',
        'cameraFieldOfView',
        'cameraDirectionHorizontal',
        'cameraDirectionVertical',
        'cameraPositionOffset',
        'cameraPositionCoordinateSpace',
        'isCharacterOrientedCamera',
        'lights.enabled',
        'lights.red / green / blue',
        'lights.type',
        'lights.position (XYZ)',
        'isCharacterOrientedLight',
        'isManualBrightnessEnabled',
        'manualBrightness',
        'characterLighting',
      ],
      candidateFields: [],
      unknownFields: [
        {
          field: 'unknownRanges',
          reason:
            '保留相机内部参数（偏移24/28，对应Camera+0x160/+0x164）及未被设置函数赋值的字节；不把XYZ后的对齐字节解释成W分量。',
          kind: 'meaning',
        },
        {
          field: 'cameraParameterAt12Raw / cameraRotationRadiansRaw',
          reason:
            '原生读取链分别映射到Camera+0x13c/+0x170；后者恢复时限制在±π，并写入+0xf8。精确业务名称或旋转轴尚未确认，保留旧cameraAngle/cameraRotation别名兼容。',
          kind: 'meaning',
        },
        {
          field: 'lights.type',
          reason: '灯光类型数值位置已确认，各数值的界面名称尚未逐一核实。',
          kind: 'meaning',
        },
      ],
    },
  };
}
