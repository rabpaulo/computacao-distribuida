import { env } from './config/env';
import { FleetGateway } from './iot/fleet.gateway';
import { ShipmentService } from './services/shipment.service';

// Instancias unicas do processo
export const fleet = new FleetGateway(env.MQTT_URL, env.MQTT_SHARED_GROUP);
export const shipmentService = new ShipmentService(fleet);

fleet.setHandlers({
  onTruckStatus: (msg) => shipmentService.handleTruckStatus(msg),
  onTelemetry: (msg) => shipmentService.handleTelemetry(msg),
  onTruckEvent: (msg) => shipmentService.handleTruckEvent(msg),
});
