function uints(data: Buffer, offset: number, count: number, width: number) {
  if (offset + count * width > data.length)
    throw new RangeError('Truncated UISAVE list');
  return Array.from({ length: count }, (_, i) =>
    data.readUIntLE(offset + i * width, width),
  );
}

function string(data: Buffer) {
  const zero = data.indexOf(0);
  return data.subarray(0, zero < 0 ? data.length : zero).toString('utf8');
}

/** Printable NUL-separated strings are candidates, not inferred record names. */
function stringCandidates(data: Buffer) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const result: { offset: number; byteLength: number; text: string }[] = [];
  let offset = 0;
  while (offset < data.length) {
    const end = data.indexOf(0, offset);
    if (end < 0) break;
    if (end - offset >= 2) {
      try {
        const text = decoder.decode(data.subarray(offset, end));
        if (text.length >= 2 && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(text)) {
          result.push({ offset, byteLength: end - offset, text });
        }
      } catch {
        /* Binary data need not be UTF-8. */
      }
    }
    offset = end + 1;
  }
  return result;
}

export function decodeAdditionalUiSegment(
  id: number,
  version: number,
  data: Buffer,
): Record<string, unknown> | null {
  if (id === 1 && version === 101 && data.length === 168) {
    return {
      countCandidate: data.readUInt32LE(0),
      unknownHeaderHex: data.subarray(4, 8).toString('hex'),
      tasks: Array.from({ length: 10 }, (_, index) => {
        const offset = 8 + index * 16;
        return {
          index,
          offset,
          retainerIdCandidate: data.readBigUInt64LE(offset).toString(),
          completionUnixCandidate: data.readUInt32LE(offset + 8),
          unknown: data.readUInt32LE(offset + 12),
        };
      }),
      note: 'u64/u32/u32 record widths and timestamps fit both samples; RetainerTaskDataModule does not publish field names.',
    };
  }
  if (
    id === 2 &&
    version === 100 &&
    data.length === 384 &&
    data.readUInt32LE(4) === 96 &&
    data.readUInt32LE(112) === 2 &&
    data.readUInt32LE(116) === 256
  ) {
    const flags = uints(data, 128, 64, 4);
    return {
      patchMarksHeaderHex: data.subarray(0, 16).toString('hex'),
      patchMarkVersions: uints(data, 16, 32, 2),
      patchMarkStates: [...data.subarray(80, 112)],
      uiFlagsHeaderHex: data.subarray(112, 128).toString('hex'),
      uiFlags: flags,
      namedFlagsCandidate: {
        summonedCompanionId: flags[1],
        lastSeenMentorVersion: flags[10],
        hideMentorRenewDialogueRaw: flags[11],
        defaultCurrencyRotationIndex: flags[13],
        currencySettingIdsPacked: flags[14],
        currencySettingRotation5: flags[15],
        actionsAndTraitsDisplayMode: flags[16],
        hidePortraitUpdatePreviewRaw: flags[21],
      },
      note: 'The disk contains a 96-byte patch-mark block and a 256-byte UI flag block. Runtime PatchMarkIds are not serialized in this sampled layout.',
    };
  }
  if (id === 4 && version === 106 && data.length === 46080) {
    return {
      groupLabelsCandidate: Array.from({ length: 7 }, (_, index) => ({
        index,
        offset: 20 + index * 64,
        name: string(data.subarray(20 + index * 64, 80 + index * 64)),
      })),
      contactRecordsCandidate: Array.from({ length: 50 }, (_, index) => {
        const offset = 488 + index * 64;
        return {
          index,
          offset,
          name: string(data.subarray(offset, offset + 32)),
          contentIdCandidate: data.readBigUInt64LE(offset + 32).toString(),
          unknownAfterContentIdHex: data
            .subarray(offset + 40, offset + 64)
            .toString('hex'),
        };
      }),
      printableStringCandidates: stringCandidates(data),
      note: 'Group/title and 50 contact record strides are supported by the historical UISAVE reader and positive names/Content IDs. Other social blocks are not mapped to friend/blacklist/mutelist categories.',
    };
  }
  if (id === 6 && version === 90 && data.length === 288) {
    return {
      firstTierCandidate: [...data.subarray(0, 128)],
      secondTierCandidate: [...data.subarray(128, 256)],
      unknownSuffixHex: data.subarray(256).toString('hex'),
      note: 'ItemContextCustomizeModule defines two 128-byte tier arrays; sampled data are zero, so these candidate offsets have no positive-value validation.',
    };
  }
  if (id === 11 && version === 0 && data.length >= 16) {
    const chunks: Record<string, unknown>[] = [];
    let offset = 0;
    while (
      offset + 16 <= data.length &&
      data.subarray(offset).some((byte) => byte !== 0)
    ) {
      const key = data.readUInt32LE(offset);
      const length = data.readUInt32LE(offset + 4);
      if (offset + 16 + length > data.length) return null;
      const body = data.subarray(offset + 16, offset + 16 + length);
      chunks.push({
        key,
        offset,
        length,
        reservedHex: data.subarray(offset + 8, offset + 16).toString('hex'),
        dataHex: body.toString('hex'),
        bytes: [...body],
        u32Values:
          body.length % 4 === 0
            ? uints(body, 0, body.length / 4, 4)
            : undefined,
      });
      offset += 16 + length;
    }
    return {
      chunks,
      zeroPaddingHex: data.subarray(offset).toString('hex'),
      note: 'Mahjong settings comprise length-delimited sub-blocks; settings/record-statistics key meanings remain unverified.',
    };
  }
  if (id === 12 && version === 3 && data.length === 1825) {
    return {
      activeSetsCandidate: Array.from({ length: 5 }, (_, index) => {
        const offset = index * 333;
        return {
          index,
          offset,
          activeBlueMageActionIds: [...data.subarray(offset, offset + 24)],
          name: string(data.subarray(offset + 24, offset + 85)),
          standardHotbars: Array.from({ length: 10 }, (_, bar) => [
            ...data.subarray(offset + 85 + bar * 12, offset + 97 + bar * 12),
          ]),
          crossHotbars: Array.from({ length: 8 }, (_, bar) => [
            ...data.subarray(offset + 205 + bar * 16, offset + 221 + bar * 16),
          ]),
          macroFlagMaskCandidateHex: data
            .subarray(1665 + index * 32, 1697 + index * 32)
            .toString('hex'),
        };
      }),
      note: 'Five packed 333-byte action/name/hotbar sets plus 160 bytes consume this version exactly. The final 32-byte-per-set macro flag masks are candidates; bit ordering is not verified.',
    };
  }
  if (id === 13 && version === 4 && data.length === 1456) {
    return {
      headerHex: data.subarray(0, 8).toString('hex'),
      firstEightLinkshellIdCandidates: Array.from({ length: 8 }, (_, slot) => ({
        slot,
        offset: 8 + slot * 8,
        id: data.readBigUInt64LE(8 + slot * 8).toString(),
      })),
      printableStringCandidates: stringCandidates(data),
      unknownRemainderHex: data.subarray(72).toString('hex'),
      note: 'The historical reader identifies the CWLS slot-assignment block, but this version has additional unmapped data.',
    };
  }
  if (id === 22 && version === 102 && data.length === 1376) {
    return {
      headerHex: data.subarray(0, 8).toString('hex'),
      retainersCandidate: Array.from({ length: 10 }, (_, index) => {
        const offset = 8 + index * 136;
        return {
          index,
          offset,
          id: data.readBigUInt64LE(offset).toString(),
          comment: string(data.subarray(offset + 8, offset + 99)),
          unusedRecordBytesHex: data
            .subarray(offset + 99, offset + 136)
            .toString('hex'),
        };
      }),
      trailerHex: data.subarray(1368).toString('hex'),
    };
  }
  if (id === 34 && version === 0 && data.length === 400) {
    return {
      wishlistItemIdsCandidate: uints(data, 0, 16, 4),
      unknownRemainderHex: data.subarray(64).toString('hex'),
      note: 'The current source exposes 16 wishlist IDs at the first module data offset. Both sampled blocks are entirely zero; count is not available in the serialized bytes.',
    };
  }
  if (id === 42 && version === 100 && data.length === 42) {
    return {
      unknownPrefix: data.readUInt16LE(0),
      glassesIdListCandidate: uints(data, 2, 20, 2),
      note: 'This matches the prefix + u16 list pattern of other collection modules, but GlassesModule fields are not yet defined in the source.',
    };
  }
  return null;
}
