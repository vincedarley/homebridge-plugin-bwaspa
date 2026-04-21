import type { Logger } from 'homebridge';
import { FLOW_GOOD } from './spaClient';
import type { SpaController } from './spaController';

const CELSIUS = 'Celsius';

/* This can be used for testing purposes. It creates a simplistic virtual
spa.  In particular this means you can test everything between the SpaController and Matter or HomeKit
without messing with your real Spa (or even without a Spa at all). */
export class DummySpaClient implements SpaController {
  accurateConfigReadFromSpa = true;

  private connected = true;
  private readonly pumpsSpeedRange = [2, 2, 1, 0, 0, 0];
  private readonly pumpsCurrentSpeed = [0, 0, 0, 0, 0, 0];
  private circulationPumpOn = true;

  private readonly lights: Array<boolean | undefined> = [false, false];
  private blowerSpeedRange = 3;
  private blowerCurrentSpeed = 0;

  private misterOn: boolean | undefined = false;
  private readonly aux: Array<boolean | undefined> = [false, false];

  private hold = false;
  private lockSettings = false;
  private lockPanel = false;

  private heatingNow = false;
  private heatingModeAlwaysReady = true;

  // External-facing temperatures are in Celsius here.
  private currentTempC = 37.0;
  private targetTempHighC = 38.0;
  private targetTempLowC = 33.0;
  private tempRangeHigh = true;

  private flowState = FLOW_GOOD;

  private removePumps = true;

  constructor(
    private readonly log: Logger,
    public readonly host: string,
    private readonly spaConfigurationKnownCallback: () => void,
    private readonly changesCallback: () => void,
    private readonly reconnectedCallback: () => void,
    devMode?: boolean,
  ) {
    void devMode;

    // Mirror SpaClient startup behavior by signaling config known quickly.
    setTimeout(() => {
      this.spaConfigurationKnownCallback();
      this.emitChange();
      this.reconnectedCallback();
    }, 0);

    this.log.info('Dummy spa client enabled. No network communication will be performed.');
  }

  shutdownSpaConnection() {
    this.connected = false;
  }

  hasGoodSpaConnection() {
    return this.connected;
  }

  getIsLightOn(index: number) {
    return this.lights[index - 1];
  }

  setLightState(index: number, value: boolean) {
    const i = index - 1;
    if (this.lights[i] === undefined) {
      return;
    }
    this.lights[i] = value;
    this.emitChange();
  }

  getPumpSpeedRange(index: number) {
    if (this.removePumps) {
      return 0;
    }
    if (index === 0) {
      return 1;
    }
    return this.pumpsSpeedRange[index - 1] ?? 0;
  }

  getPumpSpeed(index: number) {
    if (index === 0) {
      return this.circulationPumpOn ? 1 : 0;
    }
    return this.pumpsCurrentSpeed[index - 1] ?? 0;
  }

  setPumpSpeed(index: number, desiredSpeed: number) {
    if (index === 0) {
      this.circulationPumpOn = desiredSpeed !== 0;
      this.emitChange();
      return;
    }

    const i = index - 1;
    const max = this.getPumpSpeedRange(index);
    if (max === 0) {
      return;
    }
    this.pumpsCurrentSpeed[i] = Math.max(0, Math.min(max, desiredSpeed));
    this.emitChange();
  }

  getBlowerSpeedRange() {
    if (this.removePumps) {
      return 0;
    }
    return this.blowerSpeedRange;
  }

  getBlowerSpeed() {
    return this.blowerCurrentSpeed;
  }

  setBlowerSpeed(desiredSpeed: number) {
    this.blowerCurrentSpeed = Math.max(0, Math.min(this.blowerSpeedRange, desiredSpeed));
    this.emitChange();
  }

  getIsMisterOn() {
    return this.misterOn;
  }

  setMisterState(value: boolean) {
    if (this.misterOn === undefined) {
      return;
    }
    this.misterOn = value;
    this.emitChange();
  }

  getIsAuxOn(index: number) {
    return this.aux[index - 1];
  }

  setAuxState(index: number, value: boolean) {
    const i = index - 1;
    if (this.aux[i] === undefined) {
      return;
    }
    this.aux[i] = value;
    this.emitChange();
  }

  getIsHold() {
    return this.hold;
  }

  setIsHold(value: boolean) {
    this.hold = value;
    this.emitChange();
  }

  getIsLocked(entirePanel: boolean) {
    return entirePanel ? this.lockPanel : this.lockSettings;
  }

  setIsLocked(entirePanel: boolean, value: boolean) {
    if (entirePanel) {
      this.lockPanel = value;
    } else {
      this.lockSettings = value;
    }
    this.emitChange();
  }

  getIsHeatingNow() {
    return this.heatingNow;
  }

  isHeatingModeAlwaysReady() {
    return this.heatingModeAlwaysReady;
  }

  setHeatingModeAlwaysReady(isAlwaysReady: boolean) {
    this.heatingModeAlwaysReady = isAlwaysReady;
    this.tempRangeHigh = isAlwaysReady;
    this.heatingNow = isAlwaysReady && this.currentTempC < this.getTargetTempC();
    this.emitChange();
  }

  getCurrentTemp() {
    return this.currentTempC;
  }

  getTargetTemp() {
    return this.getTargetTempC();
  }

  getTargetTempHigh() {
    return this.targetTempHighC;
  }

  getTargetTempLow() {
    return this.targetTempLowC;
  }

  getTempIsCorF() {
    return CELSIUS;
  }

  convertTempToC(temp: number) {
    return temp;
  }

  convertTempFromC(temp: number) {
    return temp;
  }

  getTempRangeIsHigh() {
    return this.tempRangeHigh;
  }

  setTempRangeIsHigh(isHigh: boolean) {
    this.tempRangeHigh = isHigh;
    this.heatingNow = this.currentTempC < this.getTargetTempC();
    this.emitChange();
  }

  setTargetTemperature(temp: number) {
    if (this.tempRangeHigh) {
      this.targetTempHighC = temp;
    } else {
      this.targetTempLowC = temp;
    }
    this.heatingNow = this.currentTempC < this.getTargetTempC();
    this.emitChange();
  }

  getFlowState() {
    return this.flowState;
  }

  private getTargetTempC() {
    return this.tempRangeHigh ? this.targetTempHighC : this.targetTempLowC;
  }

  private emitChange() {
    this.changesCallback();
  }
}
