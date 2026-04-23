
<p align="center">

<img src="https://raw.githubusercontent.com/homebridge/branding/latest/logos/homebridge-color-round-stylized.png" width="150">

</p>

<span align="center">

# Homebridge Balboa Spa Plugin
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins) [![npm](https://badgen.net/npm/dt/homebridge-balboa-spa?color=purple)](https://www.npmjs.com/package/homebridge-balboa-spa)

</span>

This plugin connects to Balboa spa and hot-tub wifi modules and exposes spa controls such as pumps, lights, blower, thermostat, temperature, locks, hold mode, and water-flow status to Homebridge.

Version 3.0.0-beta.1 adds Matter accessory support alongside the existing HomeKit exposure path. Because of that, this release now requires Homebridge 2.0.0 beta.85 or later, running on Node 22 or Node 24.  Matter support is new and less tested. 

The plugin keeps control state in sync whether you manipulate the spa through Home, Siri, Matter controllers, physical controls on the spa, and takes account of situations such as filter cycles where some pumps cannot be turned off.  The Balboa Wifi module on your Spa only allows 1 connection at a time. This means you cannot use this plugin and also use the BWA Smartphone app. 

The default behaviour is to discover your spa automatically on the network, query it for supported controls, and create accessories automatically. You can override much of that behaviour through Homebridge Config UI. The plugin can also automatically correct the spa clock when daylight savings or other clock drift occurs.

<p align="left">
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/home.png" height="400"></a>
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/thermostat.png" height="400"></a>
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/pump.png" height="400"></a>
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/lights.png" height="400"></a>
</p>

Please note if your spa is controlled by Balboa's "Control My Spa" app, hardware and cloud-service, then this plugin is not compatible, and likely never will be. It works with spas that use Balboa wifi receiver module and the Balboa Worldwide App (BWA app).  Also usage of this [project](https://github.com/NorthernMan54/esp32_balboa_spa) to create your own WiFi module is supported.

Note the plugin during 2023-2025 wasn't updated because it simply works well. No meaningful bugs have been reported.  The only meaningful recent changes are to add Matter support via Homebridge 2.0's matter capabilities.  And even this has not required changing the code
which communicates with the Spa, nor the HomeKit specific code.

# Getting started

Install everything:
1. Install Homebridge 2.0.0-beta.85 or later and run it on Node 22 or Node 24.
2. Follow the step-by-step instructions on the [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x/wiki) to install Homebridge Config UI X.
3. Install homebridge-balboa-spa using: `npm install -g homebridge-balboa-spa` or search for `Balboa Spa` in Config UI X.

Restart homebridge so it reloads the new plugin.  Click through to the Balboa Spa plugin settings

<p align="center">
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/plugin.png" height="154"></a>
</p>

With a typical setup, there is nothing more you need to do (if you wish you can specify your Spa's model name). Everything should be automatic. However, you can manually specify the IP address and the particular set of controls you want to make available if you wish (or in particular if your spa cannot be automatically discovered on your network - you'll see errors in the log if that is the case). Click save and restart homebridge so the changes take effect.

<p align="center">
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/settings.png" height="400"></a>
</p>


# More details on supported accessories

This section details how this plugin translates spa controls and settings into Homebridge accessories and HomeKit or Matter device mappings.

It supports pumps that are single speed (off or high) and 2-speed (off, low, high). In both HomeKit and Matter they are represented using Fans (pumps do not exist in HomeKit and seem poorly supported in Matter). Their settings are exposed as discrete valid states only: off/high for 1-speed pumps, and off/low/high for 2-speed pumps.

You can control two lights and up to six pumps, a mister, a blower, 2 aux devices and the overall heating state of the spa. You can also view the state of the circulation pump.

If using HomeKit, the "Thermostat" device type exposes control of the spa's target temperature and high (="Heat" in Home app) vs low (="Cool" in Home app), heating mode. The low mode is generally used as a low-energy eco mode. The target temperature is separate for the two modes and the valid ranges are also different. If the flow sensor indicates water flow has failed, then the thermostat is "off". You cannot turn it off yourself because that is not a valid state for the spa itself.

For Matter controllers, the plugin creates two separate thermostats: "Primary Thermostat" (high range, 26.5-40°C) and "Eco Thermostat" (low range, 10-36°C). Only one shows as active at a time. Turning one on or off automatically switches the other. An "Eco Mode" switch is also provided as a convenient way to toggle between them. If the flow sensor indicates water flow has failed, then both thermostats are "off"

The spa's current temperature is visible both in the Thermostat device and in the read-only Temperature Sensor. Up to you whether you want both devices exposed.

The flow sensor has 3 states: normal, failed, or low water flow. In the Home app this is exposed using the leak-sensor style alerting model. In Matter this is exposed as two boolean sensors: a LeakSensor alarm endpoint for failed flow, and a separate generic OnOffSensor warning endpoint for low flow. This is useful for detecting dirty filters because reduced flow disables heating and results in the spa to cooling down.

There is a "Hold" switch to activate the Spa's hold mode (temporarily turn off all pumps, including the circulation pump), so that you can safely change filters, etc.

There are two "Locks" - one to lock the spa settings (while still allowing control over pumps, lights, etc) and second to lock the Spa completely (preventing use of any panel controls until unlocked). These
are the same locking/unlocking as Balboa provides in the Spa control panel.

Finally there are other devices on some spas: a "blower" (typically with 3-speeds), a "mister" and two auxiliary devices (aux1 and aux2).

## Version 3.0.0-beta.1 and Matter

- Minimum runtime is now Homebridge 2.0.0-beta.85 with Node 22 or Node 24.
- Added Matter accessory infrastructure and initial Matter mappings for pumps, blower, lights, switches, thermostat, temperature sensor, locks, and water flow status.
- Pump and blower Matter control now uses FanControl semantics.

## Siri

If you give your accessories good names, Siri works very well. You may need to consider the
fact that Siri understands your jets/pumps as "fans".  Also in english, "two" and "to" sound the same and I find Siri has trouble therefore with "Jet two".  But overall it works pretty well.

<p align="left">
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/siri-jet.png" height="400"></a>
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/siri-temperature.png" height="400"></a>
</p>


## Here are some sample configs

The default config handles everything automatically:
```
        {
            "autoCreateAccessories": true,
            "name": "Spa",
            "platform": "Balboa-Spa"
        }
```
In this case your homebridge log should end up containing lines like these, which show successful automatic spa discovery, connection and pump/light/etc configuration discovery and accessory creation.  You can then add these to Home and organise/rename them as you wish.
```
[Spa] Discovered a Spa at 192.168.1.151
[Spa] Successfully connected to Spa at 192.168.1.151 on port 4257
[Spa] Discovered 3 pumps with speeds [ 2, 2, 1, 0, 0, 0 ]
[Spa] Discovered 1 light
[Spa] Discovered other components: circulation-pump true , blower 0 , mister undefined , aux [ false, false ]
[Spa] Autocreating accessories...
[Spa] Pump 1 has 2 speeds.
[Spa] Pump 2 has 2 speeds.
[Spa] Pump 3 has 1 speeds.
```

However, if you wish to, or need to, make some manual adjustments, you can provide (or create via Config UI) a more elaborate config, for example:
```
{
            "name": "MasterSpa MP7",
            "autoCreateAccessories": false,
            "host": "192.168.1.151",
            "devices": [
                {
                    "name": "Pump 1",
                    "deviceType": "Pump 1"
                },
                {
                    "name": "Pump 2",
                    "deviceType": "Pump 2"
                },
                {
                    "name": "Pump 3",
                    "deviceType": "Pump 3"
                },
                {
                    "name": "Spa Lights",
                    "deviceType": "Lights 1"
                },
                {
                    "name": "Spa Temperature",
                    "deviceType": "Temperature Sensor"
                },
                {
                    "name": "Temperature Control",
                    "deviceType": "Thermostat"
                },
                {
                    "name": "Flow",
                    "deviceType": "Water Flow Problem Sensor"
                }
            ],
            "platform": "Balboa-Spa"
        }
```

## Automation and notifications

You can use the Home and Shortcuts apps to create automations, as you might with any homekit 
device. For example I've created an automation which runs when I turn off my alarm in the morning and notifies me if the spa is hot enough. I also use time-based automations to adjust the thermostat during the night to make good use of cheaper electricity.  With Matter the "Spa Eco Mode" switch is the simplest way to turn off and on the Spa's heating - I get cheap electricity at night and mostly use the spa in the early morning, so I have eco mode turned on from 8am till midnight, and then off after that.

<p align="left">
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/spa-automation1.png" height="400"></a>
  <a href="https://github.com/vincedarley/homebridge-plugin-bwaspa"><img src="https://raw.githubusercontent.com/vincedarley/homebridge-plugin-bwaspa/master/graphics/spa-automation2.png" height="400"></a>
</p>

Beyond the water-flow/leak-sensor notification which is an integral part of homekit, any other notifications you require need to be created through automations like the above.

## Limitations?

Lights are simply on/off.  Balboa provide no current capability to control the colour.  So this limitation cannot be rectified, unless Balboa enhance their product.

If the water flow sensor discovers a fault (which it checks for every ten minutes), and you then fix the issue (change or clean filters, etc), the spa does not actually notify that the fault has been corrected. However if you either use hold mode or turn the spa off and on again, then a hold or priming event will take precedence and the fault will no longer be reported through the plugin. If you do neither of those actions, then the fault will only be reset on the following day.

## Reliability

There's a fair amount of information on the internet of how the Balboa Wifi module is pretty unreliable.  In particular prior to the '-06' release of the '50350' module, it would regularly disconnect and then be unable to reconnect (without rebooting the power supply to the module).  With my own spa, the module is adequately reliable but even then does disconnect for a few minutes to an hour once every day or two, sometimes as often as a few times a day.  But between the module and this plugin's reconnect capability, a reconnection does always ultimately happen.  If your Spa's module is less reliable, I would suggest a first step is to check which module version you have.  I have found the Wifi module is more reliable with some wifi frequency bands than with others.  Finally you could replace your wifi module with this [project](https://github.com/NorthernMan54/esp32_balboa_spa) which is likely to be more reliable.

Whilst the spa is disconnected, obviously all HomeKit and Matter control attempts will fail. However this plugin is clever enough to store the major ones (adjusting thermostat, hold, lock status) and will re-apply them once the connection is re-established. 
This means that any timed automations you create, for example, should still mostly work.  For example if you have an automation to turn on "Eco Mode", but the Spa is disconnected when that automation triggers, the change will be stored and automatically applied once the Spa reconnects (typically in 20-30 minutes, based on my experience).

## Improvements

If you wish to help with any further improvements, pleasre report any problems, and please take a look in the homebridge log for lines like this:

```
[My Hot Tub] Control types reply(0a,bf,2e):1a,00,01,90,00,00
[My Hot Tub] Discovered 3 pumps with speeds [ 2, 2, 1, 0, 0, 0 ]
[My Hot Tub] Discovered 1 light
[My Hot Tub] Discovered other components: circ_pump true , blower false , mister false , aux [ false, false ]
[My Hot Tub] Control Panel reply 1:14,00,01,1e,88,00,01,1e
[My Hot Tub] First filter time from 20:00 for 01:30
[My Hot Tub] Second filter time on from 08:00 for 01:30
[My Hot Tub] ControlPanelRequest2 Sending:7e,08,0a,bf,22,02,00,00,89,7e
[My Hot Tub] Control Panel reply 2:64,e1,24,00,4d,53,34,30,45,20,20,20,01,c3,47,96,36,03,0a,44,00
[My Hot Tub] System Model MS40E   
[My Hot Tub] SoftwareID (SSID) M100_225 V36
[My Hot Tub] Current Setup 1
[My Hot Tub] Configuration Signature C3479636
[My Hot Tub] ControlPanelRequest3 Sending:7e,08,0a,bf,22,04,00,00,f4,7e
[My Hot Tub] Control Panel reply 3:05,01,32,63,50,68,61,07,41
[My Hot Tub] ControlPanelRequest4 Sending:7e,08,0a,bf,22,08,00,00,0e,7e
[My Hot Tub] Control Panel reply 4:00,85,00,01,01,02,00,00,00,00,00,00,00,00,00,00,00,00
[My Hot Tub] Checking for any Spa faults Sending:7e,08,0a,bf,22,20,ff,00,cb,7e
[My Hot Tub] No recent faults. Last fault 1 days ago of type M019 = priming (this is not actually a fault - your Spa was recently turned on) with details from log: Fault Entries: 24 Num: 24 Error code: 19 Days ago: 1 Time: 18:35 Heat mode: 24 Set temp: 38 Temp A: 38 Temp B: 38
[My Hot Tub] ConfigRequest Sending:7e,05,0a,bf,04,77,7e
[My Hot Tub] Config reply with MAC address (0a,bf,94):02,14,80,00,15,27,3f,9b,95,00,00,00,00,00,00,00,00,00,15,27,ff,ff,3f,9b,95
```

and submit those details (which will probably contain slightly different numbers) in [this issue](https://github.com/vincedarley/homebridge-plugin-bwaspa/issues/1) on github, along with the physical configuration of your spa (number of pumps, speed settings, etc). Hopefully with a bit more data we can ensure everything is interpreted correctly, if it isn't already.  The above, for example, shows that my Spa has 3 pumps, where Pump 1 is 2-speed, Pump 2 is 2-speed and Pump 3 is 1-speed. And my Spa has 1 light. This was all therefore discovered correctly.

The Spa can report many more faults/errors (some completely critical) beyond the water flow problems mentioned above. The plugin code currently ignores all other errors - it does report them in the log, but nothing more.

If you have more than one Spa, with minor modifications this plugin could happily handle that situation - please submit a bug report (and/or try to make the code changes yourself).

It looks like it might be possible to move the Flow sensor to a pair of "Filter Condition", "Filter life" settings on the thermostat. Might be a slightly better fit for Homekit's approach.

## Other related work

[Here you can read about](https://github.com/ccutrer/balboa_worldwide_app/wiki) other related work on controlling Balboa spas - including some work to understand the direct protocols the spa uses so that e.g. a raspberry pi could be used instead of the unreliable Balboa wifi module.

## Thanks

The homebridge plugin template project was the basis for this, and some Python code for connecting to balboa helped a lot in education about the communication protocols.  The node-red/MQTT/Balboa implementation served as some inspiration, but I really wanted something simpler to install and configure, and customise more precisely to deal with things like faults and temperature controls and multi-speed pumps, and with close to 100% accuracy of synchronisation between Spa state and Home state. Hence writing this plugin.

Whilst the HomeKit support was all hand-coded some years ago, to add Matter support I made extensive use of Claude.
