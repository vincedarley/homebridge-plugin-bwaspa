export interface SpaController {
  accurateConfigReadFromSpa: boolean;

  shutdownSpaConnection(): void;
  hasGoodSpaConnection(): boolean;

  getIsLightOn(index: number): boolean | undefined;
  setLightState(index: number, value: boolean): void;

  getPumpSpeedRange(index: number): number;
  getPumpSpeed(index: number): number;
  setPumpSpeed(index: number, desiredSpeed: number): void;

  getBlowerSpeedRange(): number;
  getBlowerSpeed(): number;
  setBlowerSpeed(desiredSpeed: number): void;

  getIsMisterOn(): boolean | undefined;
  setMisterState(value: boolean): void;

  getIsAuxOn(index: number): boolean | undefined;
  setAuxState(index: number, value: boolean): void;

  getIsHold(): boolean;
  setIsHold(value: boolean): void;

  getIsLocked(entirePanel: boolean): boolean;
  setIsLocked(entirePanel: boolean, value: boolean): void;

  getIsHeatingNow(): boolean;
  isHeatingModeAlwaysReady(): boolean;
  setHeatingModeAlwaysReady(isAlwaysReady: boolean): void;

  getCurrentTemp(): number | undefined;
  getTargetTemp(): number;
  getTargetTempHigh(): number | undefined;
  getTargetTempLow(): number | undefined;

  getTempIsCorF(): string;
  convertTempToC(temp: number): number | undefined;
  convertTempFromC(temp: number): number | undefined;

  getTempRangeIsHigh(): boolean;
  setTempRangeIsHigh(isHigh: boolean): void;

  setTargetTemperature(temp: number): void;

  getFlowState(): string;
}
