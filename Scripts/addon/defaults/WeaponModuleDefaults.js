(function () {
  'use strict';

  window.WeaponModuleDefaults = {
    fighter: {
      defaultConfig: 'A/A',
      loadouts: {
        'A/A': {
          gun: 412,
          left: {
            wingtip: { load: 'AIM-9X', display: '9M', quantity: 2, type: 'A/A' },
            hardpoint1: { load: 'AIM-120D', display: '12M', quantity: 2, type: 'A/A' },
            hardpoint2: { load: 'AIM-120D', display: '12M', quantity: 2, type: 'A/A' }
          },
          right: {
            wingtip: { load: 'AIM-9X', display: '9M', quantity: 2, type: 'A/A' },
            hardpoint1: { load: 'AIM-120D', display: '12M', quantity: 2, type: 'A/A' },
            hardpoint2: { load: 'AIM-120D', display: '12M', quantity: 2, type: 'A/A' }
          }
        },
        'L/R A/A': {
          gun: 412,
          left: {
            wingtip: { load: 'AIM-9X', display: '9M', quantity: 2, type: 'A/A' },
            hardpoint1: { load: 'AIM-120D', display: '12M', quantity: 2, type: 'A/A' },
            hardpoint2: { load: 'Fuel', display: 'FUEL', quantity: 1, type: 'FUEL' }
          },
          right: {
            wingtip: { load: 'AIM-9X  ', display: '9M', quantity: 2, type: 'A/A' },
            hardpoint1: { load: 'AIM-120D', display: '12M', quantity: 2, type: 'A/A' },
            hardpoint2: { load: 'Fuel', display: 'FUEL', quantity: 1, type: 'FUEL' }
          }
        },
        'A/G': {
          gun: 412,
          left: {
            wingtip: { load: 'AIM-9X', display: '9M', quantity: 2, type: 'A/A' },
            hardpoint1: { load: 'AGM-88', display: 'HARM', quantity: 1, type: 'A/G' },
            hardpoint2: { load: 'AGM-84K', display: 'SLAM-ER', quantity: 1, type: 'A/G' }
          },
          right: {
            wingtip: { load: 'AIM-9X', display: '9M', quantity: 2, type: 'A/A' },
            hardpoint1: { load: 'AGM-88', display: 'HARM', quantity: 1, type: 'A/G' },
            hardpoint2: { load: 'JDAM', display: 'JDAM', quantity: 1, type: 'A/G' }
          }
        },
        'L/R A/G': {
          gun: 412,
          left: {
            wingtip: { load: 'AIM-9X', display: '9M', quantity: 2, type: 'A/A' },
            hardpoint1: { load: 'AGM-88', display: 'HARM', quantity: 1, type: 'A/G' },
            hardpoint2: { load: 'Fuel', display: 'FUEL', quantity: 1, type: 'FUEL' }
          },
          right: {
            wingtip: { load: 'AIM-9X', display: '9M', quantity: 2, type: 'A/A' },
            hardpoint1: { load: 'AGM-88', display: 'HARM', quantity: 1, type: 'A/G' },
            hardpoint2: { load: 'Fuel', display: 'FUEL', quantity: 1, type: 'FUEL' }
          }
        },
        'L/R': {
          gun: 412,
          left: {
            wingtip: { load: 'AIM-9X', display: '9M', quantity: 1, type: 'A/A' },
            hardpoint1: { load: 'Fuel', display: 'FUEL', quantity: 1, type: 'FUEL' },
            hardpoint2: { load: 'Fuel', display: 'FUEL', quantity: 1, type: 'FUEL' }
          },
          right: {
            wingtip: { load: 'AIM-9X', display: '9M', quantity: 1, type: 'A/A' },
            hardpoint1: { load: 'Fuel', display: 'FUEL', quantity: 1, type: 'FUEL' },
            hardpoint2: { load: 'Fuel', display: 'FUEL', quantity: 1, type: 'FUEL' }
          }
        },
        'MIN': {
          gun: 300,
          left: {
            wingtip: { load: 'AIM-9X', display: '9M', quantity: 1, type: 'A/A' },
            hardpoint1: { load: 'N/A', display: 'N/A', quantity: 0, type: 'N/A' },
            hardpoint2: { load: 'N/A', display: 'N/A', quantity: 0, type: 'N/A' }
          },
          right: {
            wingtip: { load: 'AIM-9X', display: '9M', quantity: 1, type: 'A/A' },
            hardpoint1: { load: 'N/A', display: 'N/A', quantity: 0, type: 'N/A' },
            hardpoint2: { load: 'N/A', display: 'N/A', quantity: 0, type: 'N/A' }
          }
        },
        'CLEAN': {
          gun: 0,
          left: {
            wingtip: { load: 'N/A', display: 'N/A', quantity: 0, type: 'N/A' },
            hardpoint1: { load: 'N/A', display: 'N/A', quantity: 0, type: 'N/A' },
            hardpoint2: { load: 'N/A', display: 'N/A', quantity: 0, type: 'N/A' }
          },
          right: {
            wingtip: { load: 'N/A', display: 'N/A', quantity: 0, type: 'N/A' },
            hardpoint1: { load: 'N/A', display: 'N/A', quantity: 0, type: 'N/A' },
            hardpoint2: { load: 'N/A', display: 'N/A', quantity: 0, type: 'N/A' }
          }
        }
      }
    }
  };
})();
