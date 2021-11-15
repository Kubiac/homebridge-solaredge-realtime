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
  private readonly displayName;
  private readonly host;
  private readonly port;
  private readonly updateInterval;
  private currentPower = 0.0001;

  constructor(
    private readonly platform: SolaredgeRealTimePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // load all information from context
    this.displayName = accessory.context.device.displayName;
    this.host = accessory.context.device.ip;
    this.port = accessory.context.device.port || 1502;
    this.updateInterval = accessory.context.device.updateInterval || 60;

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
      const power = this.updateCurrentPower();

      this.service.updateCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel, power);
      this.platform.log.debug('Updating Ambient Light Level: ', power);
    }, this.updateInterval * 1000);
  }

  private updateCurrentPower() {
    const client = new ModbusRTU();
    const networkErrors = ['ESOCKETTIMEDOUT', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH'];

    // try to connect
    this.platform.log.debug('Connecting to', this.accessory.displayName, 'at', this.host);
    client.connectTCP(this.host, {port: this.port}).then(setClient)
      .then(() => {
        this.platform.log.debug('Connected');
      })
      .catch((e) => {
        if(e.errno) {
          if(networkErrors.includes(e.errno)) {
            this.platform.log.debug('we have to reconnect');
          }
        }
        this.platform.log.error(e.message);
      });

    function setClient() {
      client.setID(1);
      readRegisters();
    }

    const readRegisters = () => {
      client.readHoldingRegisters(40083, 2)
        .then((d) => {
          this.platform.log.debug('Received:', d.data);
          const tmpPower = d.data[0] * 10 ** (d.data[1]-65536);
          this.platform.log.debug('Computed:', tmpPower);
          this.currentPower = Math.max(tmpPower, 0.0001);

        })
        .catch((e) => {
          this.platform.log.error(e.message);
        })
        .then(close);
    };

    const close = () => {
      client.close(() => {
        this.platform.log.debug('closed connection to', this.host);
      });
    };

    return this.currentPower;
  }

  getCurrentPower() {
    return this.currentPower;
  }
}
