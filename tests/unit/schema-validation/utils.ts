/*
* utils.ts
*
* Copyright (C) 2021 by RStudio, PBC
*
*/

import { fileLoader } from "../../utils.ts";
import { unitTest } from "../../test.ts";
import { initTreeSitter } from "../../../src/core/lib/yaml-validation/deno-init-tree-sitter.ts";
import { initYamlIntelligenceResourcesFromFilesystem } from "../../../src/core/schema/utils.ts";
import {
  initState,
  setInitializer,
} from "../../../src/core/lib/yaml-validation/state.ts";
import { ensureSchemaResources } from "../../../src/core/schema/yaml-schema.ts";
import { convertFromYaml } from "../../../src/core/lib/yaml-schema/from-yaml.ts";
import { setSchemaDefinition } from "../../../src/core/lib/yaml-validation/schema.ts";
import { ValidationError } from "../../../src/core/schema/validated-yaml.ts";
import { isEqual } from "../../../src/core/lodash.ts";
import { assertRejects } from "testing/asserts.ts";
import { readYamlFromString } from "../../../src/core/yaml.ts";
export const schemaTestFile = fileLoader("schema-validation");

export async function fullInit() {
  await initYamlIntelligenceResourcesFromFilesystem();
  await initTreeSitter();
  await ensureSchemaResources();
}

export function schemaFromString(schemaStr: string) {
  const yaml = readYamlFromString(schemaStr);
  const schema = convertFromYaml(yaml);
  setSchemaDefinition(schema);
  return schema;
}

export function expectValidationError(e: ValidationError) {
  let willThrow = e instanceof ValidationError;
  const goodE = e as ValidationError;
  const result = {
    toHaveLength(l: number) {
      if (!willThrow) return result;
      if (goodE.validationErrors.length !== l) {
        willThrow = false;
      }
      return result;
    },
    toHaveInfo(key: string, which?: number) {
      if (!willThrow) return result;
      if (which === undefined) {
        which = 0;
      }
      if (goodE.validationErrors[which] === undefined) {
        willThrow = false;
        return result;
      }
      if (goodE.validationErrors[which].niceError.info[key] === undefined) {
        willThrow = false;
        return result;
      }
      return result;
    },
    forSchemaPathToEndWith(spec: string | string[], which?: number) {
      if (!willThrow) return result;
      if (typeof spec === "string") {
        spec = [spec];
      }
      if (which === undefined) {
        which = 0;
      }
      if (goodE.validationErrors[which] === undefined) {
        willThrow = false;
        return result;
      }
      if (
        !isEqual(
          spec,
          goodE.validationErrors[which].schemaPath.slice(-spec.length),
        )
      ) {
        willThrow = false;
        return result;
      }
      return result;
    },
    go() {
      if (willThrow) {
        throw e;
      }
    },
  };
  return result;
}

export type ValidationChecker = ReturnType<typeof expectValidationError>;

export async function assertYamlValidationFails(
  fun: () => Promise<unknown>,
  checker: (e: ValidationError) => ValidationChecker,
) {
  await assertRejects(async () => {
    try {
      await fun();
    } catch (e) {
      if (e instanceof ValidationError) {
        checker(e).go();
      }
    }
  });
}

// deno-lint-ignore require-await
export async function yamlValidationUnitTest(
  name: string,
  fun: () => Promise<unknown>,
) {
  unitTest(name, async () => {
    setInitializer(fullInit);
    await initState();
    await fun();
  });
}
