/*
* ranged-text.ts
*
* Copyright (C) 2021 by RStudio, PBC
*
*/

export interface Range {
  start: number;
  end: number;
}

// A ranged substring is simply a substring of some string plus the
// positional information. It's used to carry positional information of
// source code as it's processed through the system.
//
// The defining property is:
//
// const rangedSub = rangedSubstring(src, start, end);
// assert(rangedSub === src.substring(rangedSub.range.start, rangedSub.range.end));
export interface RangedSubstring {
  readonly substring: string;
  readonly range: Range;
}

export function rangedSubstring(
  src: string,
  start: number,
  end = -1,
): RangedSubstring {
  if (end === -1) {
    end = src.length;
  }

  const substring = src.substring(start, end);
  return {
    substring,
    range: { start, end },
  };
}

function matchAll(str: string, regex: RegExp) {
  let match;
  regex = new RegExp(regex); // create new to guarantee freshness wrt exec
  const result = [];
  while ((match = regex.exec(str)) != null) {
    result.push(match);
  }
  return result;
}

// RangedSubstring version of lines(), but includes the option to
// carry newlines with it, since that's sometimes useful
export function rangedLines(
  text: string,
  includeNewLines = false,
): RangedSubstring[] {
  const regex = /\r?\n/g;
  const result: RangedSubstring[] = [];

  let startOffset = 0;
  // NB can't use String.prototype.matchAll here because this is
  // getting sent into the IDE which runs an older version of the js
  // stdlib without String.prototype.matchAll

  if (!includeNewLines) {
    for (const r of matchAll(text, regex)) {
      result.push({
        substring: text.substring(startOffset, r.index!),
        range: {
          start: startOffset,
          end: r.index!,
        },
      });
      startOffset = r.index! + r[0].length;
    }
    result.push({
      substring: text.substring(startOffset, text.length),
      range: {
        start: startOffset,
        end: text.length,
      },
    });
    return result;
  } else {
    const matches = matchAll(text, regex);
    let prevOffset = 0;
    for (const r of matches) {
      const stringEnd = r.index! + 1;
      result.push({
        substring: text.substring(prevOffset, stringEnd),
        range: {
          start: prevOffset,
          end: stringEnd,
        },
      });
      prevOffset = stringEnd;
    }
    result.push({
      substring: text.substring(prevOffset, text.length),
      range: {
        start: prevOffset,
        end: text.length,
      },
    });
    return result;
  }
}
