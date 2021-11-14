# Solaredge Real Time Monitoring in Homebridge
This is a plugin to monitor one or even many SolarEdge inverter in realtime through the modbus-protocol. You need to activate the Modbus communication on your inverter first. This can be done via the display menu (if model has a display) or via the SetApp configuration website.

Example Config:
```json
{
	"platforms": [
		{
			"name" : "SolaredgeRealTime",
			"inverter" : [
				{
					"displayName" : "Photovoltaik",
					"ip" : "10.0.1.30"
				},
				{
					"displayName" : "Windkraft",
					"ip" : "10.0.1.31",
					"port" : 502,
					"updateInterval" : 60
				}
			],
			"platform" : "SolaredgeRealTime"
		}
	]
}
```
