import workerProcess from '../lib/handlers/workerProcess.js';
import { createApiHandler } from '../api/_lib/createHandler.js';

export default createApiHandler({
  methods: 'POST',
  context: 'worker-process',
  handler: workerProcess,
});
