// Legacy compatibility shim. ADI functionality moved to FlightModule.
class AdiModule {
  registerMfdPages() {
    return true;
  }
}

window.AdiModule = AdiModule;
