import { SpaClient } from '../spaClient';
import { SpaHomebridgePlatform } from '../platform';

export class MatterPumpAccessory {
  private readonly matter: any;
  private numSpeedSettings = 0;
  private scheduleId: any = undefined;
  private lastOn: boolean | undefined = undefined;
  private lastFanMode: number | undefined = undefined;
  private lastPercentSetting: number | undefined = undefined;

  /**
   * Remember the last speed so that turning the pump on returns to the previous speed.
   */
  private lastNonZeroSpeed = 1;

  private readonly name: string;

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    private readonly accessory: any,
    private readonly pumpNumber: number,
  ) {
    this.matter = (this.platform.api as any).matter;
    this.name = (pumpNumber === 0 ? 'Circulation Pump' : `Pump ${pumpNumber}`);

    if (!this.accessory.clusters) {
      this.accessory.clusters = {};
    }
    if (!this.accessory.clusters.onOff) {
      this.accessory.clusters.onOff = { onOff: false };
    }
    if (!this.accessory.clusters.fanControl) {
      this.accessory.clusters.fanControl = {
        fanMode: (this.matter.types.FanControl?.FanMode?.Off ?? 0),
        fanModeSequence: this.getFanModeSequenceOffLowHigh(),
      };
    }

    this.accessory.handlers = {
      onOff: {
        on: async () => this.setOn(true),
        off: async () => this.setOn(false),
      },
      fanControl: {
        fanModeChange: async (request: any) => {
          await this.setFanMode(request?.fanMode);
        },
        percentSettingChange: async (request: any) => {
          await this.setPercentSetting(request?.percentSetting);
        },
      },
    };
  }

  spaConfigurationKnown() {
    if (this.platform.spa!.getPumpSpeedRange(this.pumpNumber) === 0) {
      this.platform.log.warn('Nonexistent', this.name, 'matter accessory declared.');
      return;
    }

    this.numSpeedSettings = this.platform.spa!.getPumpSpeedRange(this.pumpNumber);
    this.platform.log.info(this.name, 'matter accessory has', this.numSpeedSettings, 'speeds.');

    // Pumps are either off/high (1 speed) or off/low/high (2 speeds).
    const fanModeSequence = this.numSpeedSettings <= 1
      ? this.getFanModeSequenceOffHigh()
      : this.getFanModeSequenceOffLowHigh();
    void this.matter.updateAccessoryState(this.accessory.UUID, this.matter.clusterNames.FanControl, {
      fanModeSequence,
    }).catch((error: unknown) => {
      this.platform.log.warn('Could not update pump fan mode sequence for', this.name, 'because:', error);
    });
  }

  async updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      return;
    }

    const speed = this.getSpeed();
    const isOn = speed !== 0;
    const fanMode = this.toFanModeValue(speed);
    const percentSetting = this.toPercentSettingValue(speed);

    if (this.lastOn !== isOn) {
      await this.matter.updateAccessoryState(this.accessory.UUID, this.matter.clusterNames.OnOff, { onOff: isOn });
      this.lastOn = isOn;
    }

    if (this.lastFanMode !== fanMode || this.lastPercentSetting !== percentSetting) {
      await this.matter.updateAccessoryState(this.accessory.UUID, this.matter.clusterNames.FanControl, {
        fanMode,
        percentSetting,
        percentCurrent: percentSetting,
      });
      this.lastFanMode = fanMode;
      this.lastPercentSetting = percentSetting;
    }
  }

  private async setOn(value: boolean) {
    this.platform.log.debug('Matter set', this.name, '->', value ? 'On' : 'Off', this.platform.status());

    if (!this.platform.isCurrentlyConnected()) {
      throw this.platform.connectionProblem;
    }

    if (value) {
      this.scheduleSetSpeed(this.lastNonZeroSpeed);
    } else {
      this.scheduleSetSpeed(0);
    }
  }

  private async setSpeedPercent(percent: number) {
    if (!this.platform.isCurrentlyConnected()) {
      throw this.platform.connectionProblem;
    }

    const maxSpeed = this.numSpeedSettings > 0 ? this.numSpeedSettings : this.platform.spa!.getPumpSpeedRange(this.pumpNumber);
    const speed = this.speedForPercent(percent, maxSpeed);

    this.lastNonZeroSpeed = speed > 0 ? speed : this.lastNonZeroSpeed;

    this.platform.log.debug('Matter set', this.name, 'Speed ->', percent, 'which is',
      SpaClient.getSpeedAsString(maxSpeed, speed), this.platform.status());

    this.scheduleSetSpeed(speed);
  }

  private async setFanMode(mode: number | undefined) {
    if (mode === undefined) {
      return;
    }
    if (!this.platform.isCurrentlyConnected()) {
      throw this.platform.connectionProblem;
    }

    if (mode === this.getFanModeOff()) {
      this.scheduleSetSpeed(0);
      return;
    }

    if (mode === this.getFanModeLow()) {
      this.scheduleSetSpeed(this.speedForFanMode('low'));
      return;
    }

    // Pumps have no medium state; anything else means high.
    this.scheduleSetSpeed(this.speedForFanMode('high'));
  }

  private async setPercentSetting(percentSetting: number | null | undefined) {
    if (percentSetting === undefined || percentSetting === null) {
      return;
    }
    await this.setSpeedPercent(Math.max(0, Math.min(100, percentSetting)));
  }

  private scheduleSetSpeed(speed: number) {
    const newSpeed = speed;
    if (this.scheduleId) {
      clearTimeout(this.scheduleId);
      this.scheduleId = undefined;
    }

    // Keep behavior aligned with HomeKit pump handling.
    this.scheduleId = setTimeout(() => {
      this.setSpeed(newSpeed);
      this.scheduleId = undefined;
    }, 10);
  }

  private setSpeed(speed: number) {
    this.platform.log.debug('Matter', this.name, 'actually setting speed to', speed, 'which is',
      SpaClient.getSpeedAsString(this.numSpeedSettings, speed), this.platform.status());
    this.platform.spa!.setPumpSpeed(this.pumpNumber, speed);
    if (speed !== 0) {
      this.lastNonZeroSpeed = speed;
    }
  }

  private getSpeed() {
    return this.platform.spa!.getPumpSpeed(this.pumpNumber);
  }

  private toFanModeValue(speed: number) {
    if (speed <= 0) {
      return this.getFanModeOff();
    }
    if (this.numSpeedSettings <= 1) {
      return this.getFanModeHigh();
    }
    return speed >= 2 ? this.getFanModeHigh() : this.getFanModeLow();
  }

  private toPercentSettingValue(speed: number) {
    if (speed <= 0 || this.numSpeedSettings <= 0) {
      return 0;
    }
    return Math.max(1, Math.min(100, Math.round((100.0 * speed) / this.numSpeedSettings)));
  }

  private speedForFanMode(mode: 'low' | 'medium' | 'high') {
    const maxSpeed = this.numSpeedSettings > 0 ? this.numSpeedSettings : this.platform.spa!.getPumpSpeedRange(this.pumpNumber);
    if (maxSpeed <= 1) {
      return mode === 'high' ? 1 : 0;
    }
    if (mode === 'high') {
      return maxSpeed;
    }
    // With two-speed pumps, low is the only non-high mode.
    return 1;
  }

  private speedForPercent(percent: number, maxSpeed: number) {
    if (maxSpeed <= 1) {
      return percent >= 50 ? 1 : 0;
    }
    if (percent < 25) {
      return 0;
    }
    if (percent < 75) {
      return 1;
    }
    return 2;
  }

  private getFanModeOff() {
    return this.matter.types.FanControl?.FanMode?.Off ?? 0;
  }

  private getFanModeLow() {
    return this.matter.types.FanControl?.FanMode?.Low ?? 1;
  }

  private getFanModeHigh() {
    return this.matter.types.FanControl?.FanMode?.High ?? 3;
  }

  private getFanModeSequenceOffHigh() {
    return this.matter.types.FanControl?.FanModeSequence?.OffHigh ?? 2;
  }

  private getFanModeSequenceOffLowHigh() {
    return this.matter.types.FanControl?.FanModeSequence?.OffLowHigh ?? 4;
  }
}