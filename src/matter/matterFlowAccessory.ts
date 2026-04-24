import { FLOW_FAILED, FLOW_LOW } from '../spaClient';
import { BaseMatterSpaAccessory } from './baseMatterSpaAccessory';
import type { SpaHomebridgePlatform } from '../platform';

export class MatterFlowAccessory extends BaseMatterSpaAccessory {
  private readonly mode: 'failed' | 'low';
  private lastState: boolean | undefined = undefined;

  constructor(
    platform: SpaHomebridgePlatform,
    device: { name: string; deviceType: string },
    mode: 'failed' | 'low',
  ) {
    const matter = (platform.api as any).matter;
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
    // Set initial flow state
    void this.updateCharacteristics().catch((error: unknown) => {
      this.platform.log.warn('Could not set initial flow state for', this.displayName, 'because:', error);
    });
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