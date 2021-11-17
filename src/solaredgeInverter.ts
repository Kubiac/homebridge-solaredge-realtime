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

  private networkErrors = ['ESOCKETTIMEDOUT', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH'];

  constructor(
    private readonly platform: SolaredgeRealTimePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // load all information from context
    this.id = accessory.context.device.id;
    this.displayName = accessory.context.device.displayName;
    this.host = accessory.context.device.ip;
    this.port = accessory.context.device.port || 1502;
    this.updateInterval = accessory.context.device.updateInterval || 60;
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

    setInterval(() => {
      this.updateCurrentPower();
    }, this.updateInterval * 1000);
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
      this.client.readHoldingRegisters(40083, 2)
        .then((d) => {
          this.platform.log.debug('Received:', d.data);
          const tmpPower = d.data[0] * 10 ** (d.data[1]-65536);
          this.platform.log.debug('Computed:', tmpPower);
          this.currentPower = Math.max(tmpPower, 0.0001);
        })
        .catch((e) => {
          this.platform.log.error(e.message);
          return undefined;
        })
        .then(pushValue)
        .then(close);
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

  getCurrentPower() {
    return this.currentPower;
  }
}
