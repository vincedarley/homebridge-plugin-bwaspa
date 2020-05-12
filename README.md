
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>


# Homebridge Balboa Spa Plugin

This plugin will connect some Balboa Spas over their wifi, and expose a set of controls (pumps, lights) and its temperature
in HomeKit.

Configure the plugin with Homebridge ConfigUI

## Here is a sample config

```
{
            "name": "My Hot Tub",
            "host": "192.168.1.151",
            "devices": [
                {
                    "name": "Pump 1",
                    "pumpRange": 2,
                    "deviceType": "Pump 1"
                },
                {
                    "name": "Pump 2",
                    "pumpRange": 2,
                    "deviceType": "Pump 2"
                },
                {
                    "name": "Pump 3",
                    "pumpRange": 1,
                    "deviceType": "Pump 3"
                },
                {
                    "name": "Spa Lights",
                    "deviceType": "Lights"
                },
                {
                    "name": "Spa Temperature",
                    "deviceType": "Temperature Sensor"
                }
            ],
            "platform": "Balboa-Spa"
        }
```

It supports pumps that are single speed (off or high) and 2-speed (off or low or high).

## Limitations?

I don't currently enable control of the spa's temperature or heating mode.  Nor if you have more than 3 pumps.  These could all be
added without very much work.

Lights are simply on/off.  Balboa provide no capability to control the colour.  So this limitation will never be rectified.

## Thanks

The homebridge plugin template project was the basis for this, and some Python code for connecting to balboa helped a lot.  The
node-red/MQTT/Balboa implementation served as some inspiration, but I really wanted something simpler to install and configure.

My first Typescript or Homebridge project...