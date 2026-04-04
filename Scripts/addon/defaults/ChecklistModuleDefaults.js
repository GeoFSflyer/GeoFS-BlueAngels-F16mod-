(function () {
  'use strict';

  const f18ChecklistDefaults = [
    {
      type: 'PROC',
      title: 'Engine Start',
      items: ['Parking Brake ON', 'Data Cartridge LOADED', 'Briefing CHECKED', 'Master Arm OFF', 'Radar OFF', 'Weapon Config SELECTED', 'Rearming FINISHED', 'Area CLEAR', 'Engine ON', 'Instruments CHECK'],
      completed: false
    },
    {
      type: 'PROC',
      title: 'Before Taxi',
      items: ['Ladder UP', 'Tailhook UP', 'Fuel Probe CLOSED', 'Wings LOCKED', 'Flaps MAN', 'Canopy AS DESIRED', 'Recording AS DESIRED', 'Taxi REQUESTED'],
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
      items: ['Trim SET'],
      completed: false
    },
    {
      type: 'PROC',
      title: 'Before landing',
      items: ['Master Arm OFF', 'TODO'],
      completed: false
    },
    {
      type: 'PROC',
      title: 'Landing',
      items: ['TODO'],
      completed: false
    },
    {
      type: 'PROC',
      title: 'Taxi',
      items: ['TODO'],
      completed: false
    },
    {
      type: 'PROC',
      title: 'Shutdown',
      items: ['TODO'],
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
      title: 'IFF Codebook',
      items: ['Say \'IFF [CS] - Code [NO.]\'', 'Respond with \'IFF [Code]\'', '┌─────────────────────┐', '│  01: 457 │  02: 701 │ ', '│  03: 337 │  04: 241 │ ', '│  05: 612 │  06: 135 │ ', '│  07: 402 │  08: 984 │ ', '│  09: 264 │  10: 753 │ ', '│  11: 755 │  12: 588 │ ', '│  13: 284 │  14: 000 │ ', '└─────────────────────┘'],
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
      items: ['Lock TARGET', 'Closure > 1 nm - +60knots', 'Closure 6000 ft - 60 knots', 'Closure 2000 ft - 40 knots', 'Closure 500 ft - 20 knots', 'Visual Contact', 'Take position'],
      completed: false
    },
    {
      type: 'OPS',
      title: 'Overhead Break (Landing)',
      items: ['TODO'],
      completed: false
    },
    {
      type: 'FLP',
      title: 'Briefing - Flight',
      items: ['Flight Callsign BA', 'Start Time 1300Z', 'Start Taxi 1305Z', 'Start T/O 1310Z', 'End Time 1400Z'],
      completed: false
    },
    {
      type: 'FLP',
      title: 'Briefing - Positions',
      items: ['#1 - BigE', '#2 - Natrium', '#3 - Merpati', '#4 - Sonic'],
      completed: false
    },
    {
      type: 'FLP',
      title: 'Briefing - Enroute',
      items: ['ALT FL10', 'SPD 300 knots', 'Route as planned'],
      completed: false
    },
    {
      type: 'FLP',
      title: 'Briefing - Landing',
      items: ['Primary KNPA', 'Alternate KPNS', 'Runway 25L', 'Pattern OVERHEAD BREAK', 'Formation DELTA', 'ALT Entry 200ft', 'SPD Entry 300 kn', 'Pitch int. 3s', 'Downwind 200 kn'],
      completed: false
    }
  ];

  const presets = {
    f18: f18ChecklistDefaults
  };

  function createModule(presetName = 'f18') {
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
