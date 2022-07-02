import {PlatformAccessory, Service} from 'homebridge';

import {SolaredgeRealTimePlatform} from './platform';
import ModbusRTU from 'modbus-serial';


/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SolaredgeInverter {
  private service: Service;
  readonly id;
  readonly displayName;
  private readonly host;
  private readonly port;
  private readonly updateInterval;
  private currentPower;
  private client;
  private meter;

  private networkErrors = ['ESOCKETTIMEDOUT', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH'];

  constructor(
    private readonly platform: SolaredgeRealTimePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config,
    private readonly positiveValues: boolean = true,
  ) {
    // load all information from context
    this.id = accessory.context.device.id;
    this.displayName = accessory.context.device.displayName;
    this.host = config.ip;
    this.port = config.port ?? 1502;
    this.updateInterval = config.updateInterval ?? 60;
    this.positiveValues = positiveValues;
    this.meter = config.meter ?? 0;
    this.currentPower = 0.0001;

    this.client = new ModbusRTU();
    this.client.setID(1);

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'SolarEdge')
      .setCharacteristic(this.platform.Characteristic.Model, 'Inverter')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    // get the LightSensor service if it exists, otherwise create a new LightSensor service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.LightSensor)
      || this.accessory.addService(this.platform.Service.LightSensor);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we loaded from the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.displayName);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/LightSensor
    this.service.getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel)
      .onGet(this.getCurrentPower.bind(this));

    if (this.positiveValues) {
      setInterval(() => {
        this.updateCurrentPower();
      }, this.updateInterval * 1000 - 500);
    } else {
      setInterval(() => {
        this.updateCurrentPower();
      }, this.updateInterval * 1000 + 500);
    }
  }

  private updateCurrentPower() {
    // try to connect
    this.platform.log.debug('Connecting to', this.accessory.displayName, 'at', this.host);
    this.client.connectTCP(this.host, {port: this.port})
      .then(() => readRegisters())
      .then(() => {
        this.platform.log.debug('Connected');
      })
      .catch((e) => {
        if(e.errno) {
          if(this.networkErrors.includes(e.errno)) {
            this.platform.log.debug('we have to reconnect');
          }
        }
        this.platform.log.error(e.message);
        return undefined;
      });

    const readRegisters = () => {
      let powerAdd;

      if (this.meter === 0 && this.config.powerAddress !== undefined) {
        powerAdd = 40083;
      } else if (this.config.powerAddress !== undefined) {
        powerAdd = this.config.powerAddress;
      } else {
        return undefined;
      }

      let sfAdd;
      if (this.meter === 0 && this.config.powerSfAddress !== undefined) {
        sfAdd = 40084;
      } else if (this.config.powerSfAddress !== undefined) {
        sfAdd = this.config.powerSfAddress;
      }

      const unsignedValue = this.config.powerUnsignedValue ?? true;

      let powerScalingFactor:number|undefined = undefined;
      if (sfAdd !== undefined) {
        this.client.readHoldingRegisters(sfAdd, 1)
          .then((d) => {
            this.platform.log.debug('Received SF: ', d.data);
            powerScalingFactor = d.data[0] - 65536;
          })
          .catch((e) => {
            this.platform.log.error(e.message);
            return undefined;
          });
      }

      let power = 0;
      this.client.readHoldingRegisters(powerAdd, 1)
        .then((d) => {
          this.platform.log.debug('Received Power: ', d.data);
          if (unsignedValue) {
            power = d.data[0];
          } else {
            power = d.data[0] - 65536;
          }
          this.platform.log.debug('Interpreted power value: ', power);
        }).catch((e) => {
          this.platform.log.error(e.message);
          return undefined;
        })
        .then(close)
        .then(() => {
          const tmpPower = this.computeResult(power, powerScalingFactor);
          // if data was not consistent undefined value is returned
          if (tmpPower) {
            this.currentPower = tmpPower;
          }
        })
        .then(pushValue)
        .catch((e) => {
          this.platform.log.error(e.message);
          return undefined;
        });
    };

    const pushValue = () => {
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel, this.currentPower);
      this.platform.log.debug('Updating Ambient Light Level: ', this.currentPower);
    };

    const close = () => {
      this.client.close(() => {
        this.platform.log.debug('closed connection to', this.host);
      });
    };
  }

  computeResult(value : number, scalingFactor : number|undefined) : number | undefined {
    let result:number;

    if (scalingFactor === undefined) {
      result = value;
    } else {
      if (scalingFactor === 0 && value !== 0) {
        this.platform.log.debug('Data was not consistent, not updating value.');
        return undefined;
      }
      result = value * 10 ** (scalingFactor);
    }

    if (!this.positiveValues) {
      result = -1 * result;
    }

    this.platform.log.debug('Computed:', result);
    return Math.max(result, 0.0001);
  }

  getCurrentPower() : number {
    return this.currentPower;
  }
}
