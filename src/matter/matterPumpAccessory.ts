import { SpaClient } from '../spaClient';
import { BaseMatterSpaAccessory } from './baseMatterSpaAccessory';
import type { SpaHomebridgePlatform } from '../platform';

export class MatterPumpAccessory extends BaseMatterSpaAccessory {
  private readonly pumpNumber: number;
  private numSpeedSettings = 0;
  private scheduleId: any = undefined;
  private lastOn: boolean | undefined = undefined;
  private lastFanMode: number | undefined = undefined;
  private lastPercentSetting: number | undefined = undefined;

  /**
   * Remember the last speed so that turning the pump on returns to the previous speed.
   */
  private lastNonZeroSpeed = 1;

  constructor(
    platform: SpaHomebridgePlatform,
    device: { name: string; deviceType: string },
    pumpNumber: number,
  ) {
    const matter = (platform.api as any).matter;
    // Query the spa to determine the correct fan mode sequence based on pump speed range
    const speedRange = platform.spa!.getPumpSpeedRange(pumpNumber);
    const fanModeSequence = speedRange <= 1
      ? (matter.types.FanControl?.FanModeSequence?.OffHigh ?? 2)
      : (matter.types.FanControl?.FanModeSequence?.OffLowHigh ?? 4);
    
    super(
      platform,
      device,
      matter.deviceTypes.Fan,
      {
        onOff: { onOff: false },
        fanControl: {
          fanMode: (matter.types.FanControl?.FanMode?.Off ?? 0),
          fanModeSequence,
        },
      },
      {
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
      },
    );
    this.pumpNumber = pumpNumber;
  }

  spaConfigurationKnown() {
    if (this.platform.spa!.getPumpSpeedRange(this.pumpNumber) === 0) {
      this.platform.log.warn('Nonexistent', this.displayName, 'matter accessory declared.');
      return;
    }

    this.numSpeedSettings = this.platform.spa!.getPumpSpeedRange(this.pumpNumber);
    this.platform.log.info(this.displayName, 'matter accessory has', this.numSpeedSettings, 'speeds.');

    // Fan mode sequence was already set correctly in the constructor based on discovered pump speeds.
    // Just set the initial state.
    void this.updateCharacteristics().catch((error: unknown) => {
      this.platform.log.warn('Could not set initial pump state for', this.displayName, 'because:', error);
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
      await this.updateState('onOff', { onOff: isOn });
      this.lastOn = isOn;
    }

    if (this.lastFanMode !== fanMode || this.lastPercentSetting !== percentSetting) {
      await this.updateState('fanControl', {
        fanMode,
        percentSetting,
        percentCurrent: percentSetting,
      });
      this.lastFanMode = fanMode;
      this.lastPercentSetting = percentSetting;
    }
  }

  private async setOn(value: boolean) {
    this.platform.log.debug('Matter set', this.displayName, '->', value ? 'On' : 'Off', this.platform.status());

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

    const maxSpeed = this.getMaxSpeed();
    const speed = this.speedForPercent(percent, maxSpeed);

    this.lastNonZeroSpeed = speed > 0 ? speed : this.lastNonZeroSpeed;

    this.platform.log.debug('Matter set', this.displayName, 'Speed ->', percent, 'which is',
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
    const maxSpeed = this.getMaxSpeed();
    this.platform.log.debug('Matter', this.displayName, 'actually setting speed to', speed, 'which is',
      SpaClient.getSpeedAsString(maxSpeed, speed), this.platform.status());
    this.platform.spa!.setPumpSpeed(this.pumpNumber, speed);
    if (speed !== 0) {
      this.lastNonZeroSpeed = speed;
    }
  }

  private getSpeed() {
    return this.platform.spa!.getPumpSpeed(this.pumpNumber);
  }

  private getMaxSpeed() {
    return this.numSpeedSettings > 0 ? this.numSpeedSettings : this.platform.spa!.getPumpSpeedRange(this.pumpNumber);
  }

  private toFanModeValue(speed: number) {
    if (speed <= 0) {
      return this.getFanModeOff();
    }
    const maxSpeed = this.getMaxSpeed();
    if (maxSpeed <= 1) {
      return this.getFanModeHigh();
    }
    return speed >= 2 ? this.getFanModeHigh() : this.getFanModeLow();
  }

  private toPercentSettingValue(speed: number) {
    if (speed <= 0) {
      return 0;
    }
    const maxSpeed = this.getMaxSpeed();
    if (maxSpeed <= 0) {
      return 0;
    }
    return Math.max(1, Math.min(100, Math.round((100.0 * speed) / maxSpeed)));
  }

  private speedForFanMode(mode: 'low' | 'medium' | 'high') {
    const maxSpeed = this.getMaxSpeed();
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