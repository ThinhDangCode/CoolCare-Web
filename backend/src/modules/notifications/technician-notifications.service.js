import { CustomerNotificationsService } from './customer-notifications.service.js'
import { TechnicianNotificationsRepository } from './technician-notifications.repository.js'

export class TechnicianNotificationsService extends CustomerNotificationsService {
  constructor(repository = new TechnicianNotificationsRepository()) {
    super(repository)
  }
}
