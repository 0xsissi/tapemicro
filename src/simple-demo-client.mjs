import {DemoGateway} from './demo-gateway.mjs';
import {mountApp} from './app-controller.mjs';
mountApp(new DemoGateway(),{demo:true});
