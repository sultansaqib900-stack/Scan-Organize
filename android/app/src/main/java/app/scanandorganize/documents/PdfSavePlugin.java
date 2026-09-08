package app.scanandorganize.documents;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

/** A local Storage Access Framework save dialog. No Play services, account,
 * internet, broad storage permission, or third-party PDF viewer is required.
 * Missing system pickers report unavailable so JS can use native Share instead. */
@CapacitorPlugin(name = "PdfSave")
public class PdfSavePlugin extends Plugin {
    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("fileName", "Document.pdf");
        if (name == null || name.trim().isEmpty() || name.length() > 120 || name.contains("/") || name.contains("\\") ||
            !name.toLowerCase(Locale.ROOT).endsWith(".pdf")) {
            call.reject("A valid PDF filename is required.");
            return;
        }
        try {
            sourceFile(call);
        } catch (IOException | SecurityException | IllegalArgumentException exception) {
            call.reject("The prepared PDF could not be read. Your scan is still saved. Please export again.");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/pdf")
            .putExtra(Intent.EXTRA_TITLE, name)
            .putExtra(Intent.EXTRA_LOCAL_ONLY, true);
        // A targeted <queries> declaration allows this check on Fire OS 8/API 30.
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            finish(call, "unavailable");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                startActivityForResult(call, intent, "saveResult");
            } catch (ActivityNotFoundException exception) {
                finish(call, "unavailable");
            } catch (SecurityException exception) {
                call.reject("Saving files is restricted by this device or profile. Your scan is still saved. Check the device's file-access settings.");
            } catch (IllegalStateException exception) {
                call.reject("The save dialog could not open. Return to Scan & Organize and export again. Your scan is still saved.");
            }
        });
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) return; // The OS can kill a process while a picker is open.
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            finish(call, "cancelled");
            return;
        }
        Uri destination = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || destination == null || !"content".equals(destination.getScheme())) {
            call.reject("The file picker did not return a writable location. Your scan is still saved. Please try again.");
            return;
        }
        // Stream the cache file into the user-selected URI off the UI thread.
        // Never decode another complete base64 copy into the tablet's Java heap.
        getBridge().execute(() -> {
            try {
                File source = sourceFile(call);
                try (InputStream input = new FileInputStream(source);
                     OutputStream output = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                    if (output == null) throw new IOException("No output stream");
                    byte[] buffer = new byte[64 * 1024];
                    int length;
                    while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
                    output.flush();
                }
                finish(call, "saved");
            } catch (IOException | SecurityException | IllegalArgumentException exception) {
                call.reject("The PDF could not be saved to that location. Check free space and file access, then try again. Your original scan is unchanged.");
            }
        });
    }

    /** Never let a web call copy arbitrary app files or read a network URI. */
    private File sourceFile(PluginCall call) throws IOException {
        String address = call.getString("sourceUri");
        if (address == null) throw new IOException("No source file");
        Uri uri = Uri.parse(address);
        if (!"file".equals(uri.getScheme()) || uri.getPath() == null) throw new IOException("Not a local file");
        File root = new File(getContext().getCacheDir(), "exports").getCanonicalFile();
        File file = new File(uri.getPath()).getCanonicalFile();
        if (!file.getPath().startsWith(root.getPath() + File.separator) || !file.isFile() || !file.canRead() || file.length() == 0) {
            throw new IOException("Not a prepared export");
        }
        return file;
    }

    private void finish(PluginCall call, String status) {
        JSObject result = new JSObject();
        result.put("status", status);
        call.resolve(result);
    }
}
