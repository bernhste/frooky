import { NativeHookManager } from "./native/hook/nativeHookManager";
import { NativeHookValidator } from "./native/hook/nativeHookValidator";
import { validateAndRepairFrookyConfig } from "./shared/configValidator";
import { DEFAULT_SETTING_LOG_LEVEL, DEFAULT_SETTING_LOG_TO, DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS } from "./shared/defaultValues";
import { BaseEvent } from "./shared/event/baseEvent";
import { startEventSender } from "./shared/event/eventSender";
import { HookEvent } from "./shared/event/hookEvent";
import { LogEvent } from "./shared/event/logEvent";
import { InputFrookyConfig } from "./shared/frookyConfig";
import { Platform } from "./shared/frookyMetadata";
import { FrookySettings } from "./shared/frookySettings";
import { HookManager } from "./shared/hook/hookManager";
import { HookValidator } from "./shared/hook/hookValidator";
import { logger, LogLevel, LogTo } from "./shared/logger";
import { PlatformStackTrace } from "./shared/platformStackTrace";

declare global {
  var frooky: FrookyAgent;
}

/**
 * Main application class for Frooky.
 * Manages configuration, events, and lifecycle of a frooky session.
 */
export class FrookyAgent {
  private eventCache: BaseEvent[] = [];
  private platform: Platform;
  private platformHookValidator: HookValidator<any, any>;
  private platformHookManger: HookManager<any, any, any>;
  private nativeHookValidator = new NativeHookValidator();
  private nativeHookManager: NativeHookManager;
  private resolverTimeoutSeconds: number;

  constructor(
    platform: Platform,
    platformInputHookValidator: HookValidator<any, any>,
    platformHookResolver: HookManager<any, any, any>,
    platformStackTrace: PlatformStackTrace,
    logLevel: LogLevel = DEFAULT_SETTING_LOG_LEVEL,
    logTo: LogTo = DEFAULT_SETTING_LOG_TO,
    resolverTimeoutSeconds: number = DEFAULT_SETTING_RESOLVER_TIMEOUT_SECONDS,
  ) {
    //initialize asynchronous sender
    startEventSender(this.eventCache);

    this.platform = platform;
    this.platformHookValidator = platformInputHookValidator;
    this.platformHookManger = platformHookResolver;
    this.resolverTimeoutSeconds = resolverTimeoutSeconds;
    this.nativeHookManager = new NativeHookManager(platformStackTrace);

    // setup logger
    logger.init(this, logLevel, logTo);
    logger.info("Logger initialized");

    // printing some context infos
    logger.info("Initializing frooky");
    logger.info(`Declared target platform: ${this.platform}`);
    logger.info(`Target platform: ${Process.platform}`);
    logger.info(`Target frida version: ${Frida.version}`);
    logger.info(`Target arch: ${Process.arch}`);
    logger.debug(`Target process:\n${JSON.stringify(Process, null, 2)}}`);
  }

  /**
   * Loads hook config, resolves its hooks and runs them
   *
   * @param inputFrookyConfigs - The frooky config to add.
   */
  public async loadFrookyConfigs(inputFrookyConfigs: InputFrookyConfig[]) {
    for (const inputFrookyConfig of inputFrookyConfigs) {
      try {
        await this.loadFrookyConfig(inputFrookyConfig);
      } catch (e) {
        logger.error(`Error during loading of the frooky config: ${String(e)}`);
      }
    }
  }

  /**
   * Validates and registers a {@link InputFrookyConfig}.
   *
   * @param inputFrookyConfig - The configuration to add.
   */
  public async loadFrookyConfig(inputFrookyConfig: InputFrookyConfig) {
    logger.debug("Loading frooky configuration.");

    // validate frooky config
    logger.debug("Validating frooky configuration");
    let validFrookyConfig: InputFrookyConfig;
    try {
      validFrookyConfig = validateAndRepairFrookyConfig(inputFrookyConfig, this.platform);
    } catch (e) {
      logger.warn(`Skipping frooky config: ${e}`);
      return;
    }

    const validatedFrookySettings = validFrookyConfig.settings as FrookySettings;

    // validate the platform hooks
    logger.debug(`Validating '${this.platform}' hooks`);
    const validPlatformHooks = this.platformHookValidator.validateAndNormalizeHooks(inputFrookyConfig, validatedFrookySettings);

    logger.debug(`Validating 'native' hooks`);
    const validNativeHook = this.nativeHookValidator.validateAndNormalizeHooks(inputFrookyConfig, validatedFrookySettings);

    // preparing stats
    let countSuccessfulPlatformHooks = 0;
    let countSuccessfulNativeHooks = 0;

    // async resolve platform hooks and register them
    const platformPromises = this.platformHookManger
      .resolveHooks(validPlatformHooks, this.resolverTimeoutSeconds)
      .then((platformHookPromises) =>
        Promise.allSettled(
          platformHookPromises.map((p) =>
            p.then((platformHooks) => {
              if (platformHooks) this.platformHookManger.registerHooks(platformHooks);
            }),
          ),
        ),
      )
      .catch((e) => {
        logger.error(`Error while resolving platform hooks: ${String(e)}`);
      });

    // async resolve native hooks and register them
    const nativePromises = this.nativeHookManager
      .resolveHooks(validNativeHook, this.resolverTimeoutSeconds)
      .then((nativeHookPromises) => {
        return Promise.allSettled(
          nativeHookPromises.map((nativeHookPromise) =>
            nativeHookPromise.then((nativeHooks) => {
              if (nativeHooks) {
                countSuccessfulNativeHooks += this.nativeHookManager.registerHooks(nativeHooks);
              }
            }),
          ),
        );
      })
      .catch((e) => {
        logger.error(`Error while resolving native hooks: ${String(e)}`);
      });

    const configName = inputFrookyConfig.metadata?.name;
    const nameSuffix = configName ? ` '${configName}'` : "";
    const hookSuffix = configName ? ` from frooky configuration '${configName}'` : "";

    logger.info(`Frooky configuration${nameSuffix} successfully parsed`);

    await Promise.all([
      Promise.all([platformPromises]).then(() => {
        if (countSuccessfulPlatformHooks > 0) {
          logger.info(`Successfully hooked ${countSuccessfulPlatformHooks} ${this.platform} methods${hookSuffix}`);
        }
      }),
      Promise.all([nativePromises]).then(() => {
        if (countSuccessfulNativeHooks > 0) {
          logger.info(`Successfully hooked ${countSuccessfulNativeHooks} native functions${hookSuffix}`);
        }
      }),
    ]);
    if (countSuccessfulPlatformHooks === 0 && countSuccessfulNativeHooks === 0) {
      // TODO: FIX, is shown even if all is
      // logger.warn(`No hooks were loaded. Either the hook file was empty, or the declared hooks could not be resolved.`);
    }
  }

  /**
   * Adds an event to the internal event cache.
   *
   * @param event - The event to cache.
   */
  public addEventToLog(event: LogEvent | HookEvent): void {
    this.eventCache.push(event);
  }
}
