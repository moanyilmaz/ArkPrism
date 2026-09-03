import socket from '@ohos.net.socket';
import resourceManager from '@ohos.resourceManager';
import camera from '@ohos.multimedia.camera';

declare function getContext(value: object): {
  resourceManager: resourceManager.ResourceManager;
};

export async function inspectReceiverOrigins(): Promise<void> {
  const resMgr = getContext({}).resourceManager;
  await resMgr.getDeviceCapability();

  const tcp = socket.constructTCPSocketInstance();
  await tcp.close();

  const tlsServer = socket.constructTLSSocketServerInstance();
  await tlsServer.close();
}

class LocalPage {
  getSupportedCameras(): void {
  }

  invokeLocalWrapper(): void {
    this.getSupportedCameras();
    camera;
  }
}
