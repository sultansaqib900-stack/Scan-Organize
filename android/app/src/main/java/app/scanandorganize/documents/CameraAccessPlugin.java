package app.scanandorganize.documents;

import android.Manifest;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Requests Android CAMERA permission only. Capture itself uses getUserMedia in
 * the WebView; Capacitor's BridgeWebChromeClient grants the VIDEO_CAPTURE origin
 * request after this permission is available. No microphone or storage access. */
@CapacitorPlugin(
    name = "CameraAccess",
    permissions = { @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }) }
)
public class CameraAccessPlugin extends Plugin {
    @PluginMethod
    public void request(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            resolvePermission(call);
        } else {
            requestPermissionForAlias("camera", call, "cameraPermissionResult");
        }
    }

    @PermissionCallback
    private void cameraPermissionResult(PluginCall call) {
        resolvePermission(call);
    }

    private void resolvePermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("state", getPermissionState("camera") == PermissionState.GRANTED ? "granted" : "denied");
        call.resolve(result);
    }
}
