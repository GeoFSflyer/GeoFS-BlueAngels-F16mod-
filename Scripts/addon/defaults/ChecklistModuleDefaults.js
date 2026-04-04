(function () {
  'use strict';

  const fighterChecklistDefaults = [
    {
      type: 'PROC',
      title: 'Engine Start',
      items: ['Parking Brake ON', 'Data Cartridge LOADED', 'Briefing/Mission CHECKED', 'Master Arm OFF', 'Radar OFF', 'Weapon Config SELECTED', 'Rearming FINISHED', 'Area CLEAR', 'Engine ON', 'Instruments CHECK'],
      completed: false
    },
    {
      type: 'PROC',
      title: 'Before Taxi',
      items: ['Ladder UP', 'Tailhook UP', 'Fuel Probe CLOSED', 'TGP Power OFF', 'Wings LOCKED', 'Flaps MAN', 'Canopy AS DESIRED', 'Recording AS DESIRED', 'Taxi REQUESTED'],
      completed: false
    },
    {
      type: 'PROC',
      title: 'Taxi / Before Takeoff',
      items: ['Taxi Clearance GRANTED', 'Parking Brake OFF', 'Flaps ONE', 'HUD Bright/LVL AS DESIRED', 'Trim SET T/O', 'Canopy CLOSED', 'Spoiler UP', 'Brakes CHECK', 'Flight Controls CHECK', 'Instruments CHECK', 'Takeoff Clearance REQUESTED'],
      completed: false
    },
    {
      type: 'PROC',
      title: 'Takeoff',
      items: ['Takeoff Clearance GRANTED', 'Runway CLEAR', 'Runway ALIGNED', 'Flaps ONE CHECK', 'Brakes ON', 'Engine 30%', 'Brakes RELEASED', 'Engine 100%', 'Speed 175 KN', 'Climb POSITIVE', 'Gear UP'],
      completed: false
    },
    {
      type: 'PROC',
      title: 'Climb',
      items: ['Flaps AUTO', 'Attitude SET', 'Trim SET', 'Radar AS DESIRED'],
      completed: false
    },
    {
      type: 'PROC',
      title: 'Cruise',
      items: ['Altitude AS BRIEFED', 'Speed AS BRIEFED', 'Trim SET', 'HUD Brightness AS DESIRED', 'HUD Level AS DESIRED'],
      completed: false
    },
    {
      type: 'PROC',
      title: 'Descent',
      items: ['Trim SET', 'Approach BRIEFED', 'ATIS CHECKED', 'Approach Clearance REQUESTED'],
      completed: false
    },
    {
      type: 'PROC',
      title: 'Before landing',
      items: ['Master Arm OFF', 'Radar OFF', 'Targeting Pod OFF', 'Landing Gear 3 GREEN', 'Flaps FULL'],
      completed: false
    },
    {
      type: 'PROC',
      title: 'After Landing',
      items: ['Taxi CLEAR OF RUNWAY', 'Taxi Clearance REQUESTED', 'Flaps UP'],
      completed: false
    },
    {
      type: 'PROC',
      title: 'Taxi',
      items: ['Taxi TO PARKING', 'Canopy AS DESIRED'],
      completed: false
    },
    {
      type: 'PROC',
      title: 'Shutdown',
      items: ['Parking Brake ON', 'Engine OFF'],
      completed: false
    },
    {
      type: 'EMER',
      title: 'Engine Fire',
      items: ['Throttle IDLE', 'Engine OFF', 'Divert NEAREST', 'Descent GLIDE', 'Airspeed SET OPTIMAL', 'Radio MAYDAY', 'Land ASAP'],
      completed: false
    },
    {
      type: 'OPS',
      title: 'Targeting Pod - A/G',
      items: ['Flightplan OPEN', 'Target MARK AS WAYPOINT', 'Entry INGRESS FROM SOUTH', 'Heading 0°', 'Flightplan SELECT TARGET WP', 'MFD SWITCH TO TGP', 'MODE/FREQ AS DESIRED', 'FOV WIDE', 'View ADJUST', 'FOV NARROW'],
      completed: false
    },
    {
      type: 'OPS',
      title: 'Targeting Pod - A/A',
      items: ['MFD SWITCH TO RDR', 'Radar ON', 'Foo AS DESIRED', 'MFD SWITCH TO NAV', 'A/C SELECT', 'MFD SWITCH TO TGP', 'Entry INGRESS FROM SOUTH', 'Heading 0°', 'Lock SET TO TRK', 'MODE / FOV AS DESIRED'],
      completed: false
    },
    {
      type: 'OPS',
      title: 'Formation (Re)join',
      items: ['Target LOCK', 'Closure > 1 nm - +60knots', 'Closure 6000 ft - 60 knots', 'Closure 2000 ft - 40 knots', 'Closure 500 ft - 20 knots', 'Visual Contact', 'Take position'],
      completed: false
    },
    {
      type: 'OPS',
      title: 'Overhead Break (Landing)',
      items: ['Runway DETERMINED', 'RW + break to L/R ANNOUNCED', 'Runway ALIGN', 'Alt/Speed AS BRIEFED', '#1 Break ANNOUNCE', '#1 BREAK', '#2 and up REPEAT', 'Downwind Speed AS BRIEFED', 'Land'],
      completed: false
    }
  ];

  const presets = {
    fighter: fighterChecklistDefaults
  };

  function createModule(presetName = 'fighter') {
    if (typeof ChecklistModule !== 'function') {
      return null;
    }

    const preset = presets[presetName] ?? [];
    const module = new ChecklistModule();
    for (const definition of preset) {
      module.addChecklist(HelperModule.deepCloneJson(definition));
    }
    return module;
  }

  window.ChecklistModuleDefaults = {
    presets,
    createModule
  };
})();
