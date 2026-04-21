import { FLOW_FAILED, FLOW_LOW } from '../spaClient';
import { BaseMatterSpaAccessory } from './baseMatterSpaAccessory';
import type { SpaHomebridgePlatform } from '../platform';

export class MatterFlowAccessory extends BaseMatterSpaAccessory {
  private readonly mode: 'failed' | 'low';
  private lastState: boolean | undefined = undefined;

  constructor(
    platform: SpaHomebridgePlatform,
    device: { name: string; deviceType: string },
  ) {
    const matter = (platform.api as any).matter;
    const mode: 'failed' | 'low' = device.deviceType === 'Water Flow Problem Sensor' ? 'failed' : 'low';
    const matterDeviceType = mode === 'failed'
      ? matter.deviceTypes.LeakSensor
      : matter.deviceTypes.ContactSensor;
    super(
      platform,
      device,
      matterDeviceType,
      { booleanState: { stateValue: false } },
    );
    this.mode = mode;
  }

  spaConfigurationKnown() {
    // nothing to do
  }

  async updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      return;
    }
    const flowState = this.platform.spa!.getFlowState();
    const stateValue = this.mode === 'failed'
      ? flowState === FLOW_FAILED
      : flowState === FLOW_LOW;

    if (this.lastState !== stateValue) {
      await this.updateState('booleanState', { stateValue });
      this.lastState = stateValue;
    }
  }
}