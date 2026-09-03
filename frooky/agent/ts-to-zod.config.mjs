/**
 * ts-to-zod configuration.
 *
 * @type {import("ts-to-zod").TsToZodConfig}
 */
export default [

    // 1. Internal Types
    // These types are only used internally, but ZOD needs them as reference wen validating te INPUT YAMLs

    {
        "name": "frooky_settings",
        "input": "src/shared/frookySettings.ts",
        "output": "src/shared/inputParsing/zodSchemas/frookySettings.zod.ts"
    },

    {
        "name": "logger",
        "input": "src/shared/logger.ts",
        "output": "src/shared/inputParsing/zodSchemas/logger.zod.ts"
    },


    // 2. Types used in the input YAMLs. They usually have less strict requirements or multiple ways of declaring a method, function parameter etc.
    // These are the types used to validate the input YAML
   {
        "name": "hook_decoder_settings_input",
        "input": "src/shared/inputParsing/inputSettings.ts",
        "output": "src/shared/inputParsing/zodSchemas/inputSettings.zod.ts"
    },
    
    {
        "name": "java_hook_scope",
        "input": "src/shared/inputParsing/inputJavaHookGroup.ts",
        "output": "src/shared/inputParsing/zodSchemas/inputJavaHookGroup.zod.ts"
    },
    
    {
        "name": "native_hook_scope",
        "input": "src/shared/inputParsing/inputNativeHookGroup.ts",
        "output": "src/shared/inputParsing/zodSchemas/inputNativeHookGroup.zod.ts"
    },

    {
        "name": "decodable_types_input",
        "input": "src/shared/inputParsing/inputDecodableTypes.ts",
        "output": "src/shared/inputParsing/zodSchemas/inputDecodableTypes.zod.ts"
    },

    {
        "name": "frooky_config",
        "input": "src/shared/frookyConfig.ts",
        "output": "src/shared/inputParsing/zodSchemas/frookyConfig.zod.ts"
    },

    {
        "name": "frooky_metadata",
        "input": "src/shared/frookyMetadata.ts",
        "output": "src/shared/inputParsing/zodSchemas/frookyMetadata.zod.ts"
    }
]
