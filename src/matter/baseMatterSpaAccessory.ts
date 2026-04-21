import type { MatterAccessory } from 'homebridge';
import type { EndpointType } from 'homebridge';
import { VERSION } from '../settings';
import type { SpaHomebridgePlatform } from '../platform';

/**
 * Base class for all spa Matter accessories.
 *
 * Each subclass extends this and calls super() with the correct deviceType,
 * clusters, and handlers. State updates use the inherited updateState() helper.
 * The class instance itself satisfies the MatterAccessory interface and can be
 * passed directly to matter.registerPlatformAccessories().
 */
export abstract class BaseMatterSpaAccessory implements MatterAccessory {
  public readonly UUID: string;
  public readonly displayName: string;
  public readonly deviceType: EndpointType;
  public readonly serialNumber: string;
  public readonly manufacturer = 'Balboa';
  public readonly model: string;
  public readonly firmwareRevision: string;
  public readonly hardwareRevision: string;
  public readonly context: Record<string, unknown>;
  public clusters?: MatterAccessory['clusters'];
  public handlers?: MatterAccessory['handlers'];

  protected readonly matter: any;

  protected constructor(
    protected readonly platform: SpaHomebridgePlatform,
    device: { name: string; deviceType: string },
    matterDeviceType: EndpointType,
    clusters: MatterAccessory['clusters'],
    handlers?: MatterAccessory['handlers'],
  ) {
    this.matter = (platform.api as any).matter;
    this.UUID = this.matter.uuid.generate(device.deviceType);
    this.serialNumber = this.UUID.replace(/-/g, '').slice(0, 32);
    this.displayName = device.name;
    this.deviceType = matterDeviceType;
    this.model = platform.name;
    this.firmwareRevision = VERSION;
    this.hardwareRevision = VERSION;
    this.clusters = clusters;
    this.handlers = handlers;
    this.context = { device };
  }

  protected async updateState(cluster: string, attributes: Record<string, unknown>): Promise<void> {
    await (this.platform.api as any).matter.updateAccessoryState(this.UUID, cluster, attributes);
  }

  abstract spaConfigurationKnown(): void;
  abstract updateCharacteristics(): Promise<void>;
}
