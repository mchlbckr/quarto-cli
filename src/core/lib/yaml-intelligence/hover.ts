/*
* hover.ts
*
* Copyright (C) 2022 by RStudio, PBC
*
*/

import { readAnnotatedYamlFromMappedString } from "./tree-sitter-annotated-yaml.ts";
import { breakQuartoMd, QuartoMdCell } from "../break-quarto-md.ts";
import { asMappedString, MappedString } from "../mapped-text.ts";
import { kLangCommentChars } from "../partition-cell-options.ts";
import { rangedLines } from "../ranged-text.ts";
import { indexToRowCol, lines } from "../text.ts";
import { navigateSchemaByInstancePath } from "../yaml-validation/schema-navigation.ts";
import {
  AnnotatedParse,
  ConcreteSchema,
  Schema,
} from "../yaml-schema/types.ts";
import { YamlIntelligenceContext } from "./types.ts";
import { resolveSchema } from "../yaml-validation/schema-utils.ts";
import { getFrontMatterSchema } from "../../lib/yaml-schema/front-matter.ts";
import { getEngineOptionsSchema } from "../../lib/yaml-schema/chunk-metadata.ts";
import { getProjectConfigSchema } from "../yaml-schema/project-config.ts";

// we use vscode interface here
interface Position {
  line: number;
  character: number;
}

export interface Hover {
  content: string;
  range: {
    start: Position;
    end: Position;
  };
}

interface State {
  annotation: AnnotatedParse;
  position: "key" | "value";
  path: (string | number)[];
}

function buildLineMap(
  annotation: AnnotatedParse,
  document: MappedString,
): Record<number, State> {
  const result: Record<number, State> = {};

  const walk = (
    s: State,
    f: (s: State) => unknown,
  ) => {
    const result = f(s) as boolean;
    if (result === true) {
      return;
    }
    const { annotation, path } = s;

    const isMapping =
      ["block_mapping", "flow_mapping", "mapping"].indexOf(annotation.kind) !==
        -1;

    for (let i = 0; i < annotation.components.length; ++i) {
      const child = annotation.components[i];
      const keyOrValue = isMapping && (i & 1) === 0 ? "key" : "value";
      if (isMapping) {
        path.push(annotation.components[i & (~1)].result as string);
      } else {
        // must be a sequence
        path.push(i);
      }
      walk({ annotation: child, position: keyOrValue, path }, f);
      path.pop();
    }
  };

  const f = indexToRowCol(document.value);
  const state: State = {
    annotation,
    path: [],
    position: "value",
  };

  walk(state, (state) => {
    const { annotation: a, position: kOrV } = state;
    if (kOrV === "key") {
      state = { ...state };
      state.path = state.path.slice();
      const pos = f(a.start);
      result[pos.line] = state;
    }
  });
  return result;
}

export async function hover(
  context: YamlIntelligenceContext,
): Promise<Hover | null> {
  const foundCell = await locateCellWithCursor(context);
  if (!foundCell) {
    return null;
  }

  const { doc: vd, schema } = await createVirtualDocument(context);

  const mappedVd = asMappedString(vd);
  const annotation = await readAnnotatedYamlFromMappedString(
    mappedVd,
  );
  if (annotation === null) {
    // failed to produce partial parsed yaml, don't give hover info
    return null;
  }
  /*const offset = rowColToIndex(vd)(context.position);
  const { withError, value, kind, annotation: innerAnnotation } = locateCursor(
    annotation,
    offset,
  );*/
  const mapping = buildLineMap(annotation, mappedVd);
  if (mapping[context.position.row] === undefined) {
    return null;
  }
  const { path: navigationPath } = mapping[context.position.row];

  const result: string[] = [];
  for (
    const matchingSchema of navigateSchemaByInstancePath(
      schema,
      navigationPath,
    ) as Schema[]
  ) {
    if (matchingSchema === false || matchingSchema === true) {
      continue;
    }
    const concreteSchema = resolveSchema(matchingSchema) as ConcreteSchema;
    if (concreteSchema.tags && concreteSchema.tags.description) {
      const desc = concreteSchema.tags.description as {
        short: string;
        long: string;
      } | string;
      if (typeof desc === "string") {
        result.push(desc);
      } else {
        result.push(desc.long);
      }
    }
  }

  return {
    content: `**${navigationPath.slice(-1)[0]}**\n\n` + result.join("\n\n"),
    range: {
      start: {
        line: context.position.row,
        character: 0,
      },
      end: {
        line: context.position.row,
        character:
          lines(asMappedString(context.code).value)[context.position.row]
            .length,
      },
    },
  };
}

export async function createVirtualDocument(
  context: YamlIntelligenceContext,
): Promise<{
  doc: string;
  schema: ConcreteSchema;
}> {
  if (context.filetype === "yaml") {
    // right now we assume this is _quarto.yml
    return {
      doc: asMappedString(context.code).value,
      schema: await getProjectConfigSchema(),
    };
  }
  const nonSpace = /[^\r\n]/g;
  const { cells } = await breakQuartoMd(asMappedString(context.code));
  const chunks = [];
  let schema: ConcreteSchema;
  for (const cell of cells) {
    const cellLines = rangedLines(cell.source.value, true);
    const size = cellLines.length;
    if (size + cell.cellStartLine > context.position.row) {
      if (cell.cell_type === "raw") {
        // cursor is in a yaml block, so we don't push the triple-tick context
        for (const { substring } of cellLines) {
          if (substring.trim() === "---") {
            chunks.push(substring.replace(nonSpace, " "));
          } else {
            chunks.push(substring);
          }
        }
        schema = await getFrontMatterSchema();
      } else if (cell.cell_type === "markdown" || cell.cell_type === "math") {
        // no yaml in a markdown block;
      } else {
        // code chunk of some kind
        schema = (await getEngineOptionsSchema())[context.engine || "markdown"];
        const commentPrefix = kLangCommentChars[cell.cell_type.language] + "| ";

        for (const { substring } of cellLines) {
          if (substring.startsWith(commentPrefix)) {
            chunks.push(
              substring.replace(
                commentPrefix,
                " ".repeat(commentPrefix.length),
              ),
            );
          } else {
            chunks.push(substring.replace(nonSpace, " "));
          }
        }
      }
      break;
    } else {
      chunks.push(cell.source.value.replace(/[^\r\n]/g, " "));
    }
  }
  return {
    doc: chunks.join(""),
    schema: schema!,
  };
}

async function locateCellWithCursor(
  context: YamlIntelligenceContext,
): Promise<QuartoMdCell | undefined> {
  const result = await breakQuartoMd(asMappedString(context.code));

  let foundCell = undefined;
  for (const cell of result.cells) {
    const size = lines(cell.source.value).length;
    if (size + cell.cellStartLine > context.position.row) {
      foundCell = cell;
      break;
    }
  }
  return foundCell;
}
