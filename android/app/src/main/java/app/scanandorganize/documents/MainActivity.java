package app.scanandorganize.documents;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CameraAccessPlugin.class);
        registerPlugin(PdfSavePlugin.class);
        super.onCreate(savedInstanceState);
        // Capacitor 8's built-in SystemBars handles native insets and the IME.
        // capacitor.config.ts selects light bars; CSS consumes the safe-area values.
    }
}
