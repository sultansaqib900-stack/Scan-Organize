package app.scanandorganize.documents;

import static org.junit.Assert.*;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import androidx.core.content.FileProvider;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real Android/WebView smoke tests. Run on a camera-capable emulator or device:
 * npm run android:sync && cd android && ./gradlew connectedDebugAndroidTest
 * These do NOT run as part of the browser/bridge-contract test suite. */
@RunWith(AndroidJUnit4.class)
public class OfflineWebViewTest {
    private static final String APP_ID = "app.scanandorganize.documents";

    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch finished = new CountDownLatch(1);
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> {
            result.set(value);
            finished.countDown();
        }));
        assertTrue("WebView JavaScript callback timed out", finished.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    private void awaitTrue(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 25000;
        while (SystemClock.elapsedRealtime() < deadline) {
            if ("true".equals(evaluate(scenario, script))) return;
            Thread.sleep(100);
        }
        fail("WebView condition did not become true: " + script + "; result: " + evaluate(scenario, script));
    }

    private void awaitLibrary(ActivityScenario<MainActivity> scenario) throws Exception {
        awaitTrue(scenario, "document.readyState === 'complete' && !!document.querySelector('.folder-card') && !!window.Capacitor?.Plugins?.CameraAccess");
    }

    @Test
    public void bundledLibraryLoadsAtASecureOriginWithoutNetworkPermission() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals(APP_ID, context.getPackageName());
        assertEquals(PackageManager.PERMISSION_DENIED, context.checkSelfPermission(Manifest.permission.INTERNET));
        assertEquals(PackageManager.PERMISSION_DENIED, context.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE));
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitLibrary(scenario);
            assertEquals("true", evaluate(scenario, "window.isSecureContext && location.origin === 'https://localhost' && window.Capacitor.isNativePlatform()"));
            scenario.onActivity(activity -> {
                assertNotNull(activity.getBridge().getPlugin("CameraAccess"));
                assertNotNull(activity.getBridge().getPlugin("Filesystem"));
                assertNotNull(activity.getBridge().getPlugin("Share"));
                assertNotNull(activity.getBridge().getPlugin("PdfSave"));
            });
        }
    }

    @Test
    public void webViewPersistsBlobDataAndSmallMetadata() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitLibrary(scenario);
            evaluate(scenario, """
                (() => {
                  window.__storageSmoke = 'running';
                  const fail = e => window.__storageSmoke = 'error: ' + (e?.message || e);
                  try {
                    localStorage.setItem('scan-organize:smoke', 'local metadata');
                    if (localStorage.getItem('scan-organize:smoke') !== 'local metadata') throw new Error('localStorage mismatch');
                    localStorage.removeItem('scan-organize:smoke');
                    const req = indexedDB.open('scan-organize-native-smoke', 1);
                    req.onupgradeneeded = () => req.result.createObjectStore('pages');
                    req.onerror = () => fail(req.error);
                    req.onsuccess = () => {
                      const db = req.result;
                      const tx = db.transaction('pages', 'readwrite');
                      tx.objectStore('pages').put(new Blob([new Uint8Array([10, 20, 30])], {type: 'image/jpeg'}), 'test-page');
                      tx.onabort = () => { db.close(); fail(tx.error); };
                      tx.oncomplete = () => {
                        const read = db.transaction('pages').objectStore('pages').get('test-page');
                        read.onerror = () => { db.close(); fail(read.error); };
                        read.onsuccess = async () => {
                          try {
                            const bytes = new Uint8Array(await read.result.arrayBuffer());
                            if (bytes.join(',') !== '10,20,30') throw new Error('Blob roundtrip mismatch');
                            window.__storageSmoke = 'ok';
                          } catch (e) { fail(e); }
                          finally { db.close(); indexedDB.deleteDatabase('scan-organize-native-smoke'); }
                        };
                      };
                    };
                  } catch(e) { fail(e); }
                })();
                """);
            awaitTrue(scenario, "!!window.__storageSmoke && window.__storageSmoke !== 'running'");
            assertEquals("\"ok\"", evaluate(scenario, "window.__storageSmoke"));
        }
    }

    @Test
    public void nativeCameraPermissionGetUserMediaAndCanvasCaptureWork() throws Exception {
        // The test runner explicitly grants camera access. The application itself
        // requests consent via CameraAccess; denial is covered by the manual checklist.
        ParcelFileDescriptor result = InstrumentationRegistry.getInstrumentation().getUiAutomation()
            .executeShellCommand("pm grant " + APP_ID + " android.permission.CAMERA");
        try (InputStream stream = new ParcelFileDescriptor.AutoCloseInputStream(result)) {
            while (stream.read() != -1) { /* Wait for pm to finish. */ }
        }
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitLibrary(scenario);
            evaluate(scenario, """
                (async () => {
                  window.__cameraSmoke = 'running';
                  let stream, video;
                  try {
                    const permission = await Capacitor.Plugins.CameraAccess.request();
                    if (permission.state !== 'granted') throw new Error('Native CAMERA permission not granted');
                    stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}}, audio: false});
                    video = document.createElement('video'); video.muted = true; video.playsInline = true;
                    video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px';
                    document.body.appendChild(video); video.srcObject = stream; await video.play();
                    if (video.readyState < 2) await new Promise(resolve => video.addEventListener('loadeddata', resolve, {once:true}));
                    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 320;
                    canvas.getContext('2d').drawImage(video, 0, 0, 240, 320);
                    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
                    if (!blob || !blob.size || !video.videoWidth) throw new Error('Camera frame is empty');
                    canvas.width = canvas.height = 0;
                    window.__cameraSmoke = 'ok';
                  } catch(e) { window.__cameraSmoke = 'error: ' + e.message; }
                  finally { stream?.getTracks().forEach(track => track.stop()); video?.remove(); }
                })();
                """);
            awaitTrue(scenario, "!!window.__cameraSmoke && window.__cameraSmoke !== 'running'");
            assertEquals("\"ok\"", evaluate(scenario, "window.__cameraSmoke"));
        }
    }

    @Test
    public void nativeCacheAndFileProviderCanServeAnExportWithoutStoragePermission() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitLibrary(scenario);
            evaluate(scenario, """
                (async () => {
                  window.__fileSmoke = 'running';
                  try {
                    const options = {path:'exports/webview-smoke.pdf', directory:'CACHE'};
                    const data = 'JVBERi0xLjQKJSVFT0YK';
                    const result = await Capacitor.nativePromise('Filesystem', 'writeFile', {...options, data, recursive:true});
                    const read = await Capacitor.nativePromise('Filesystem', 'readFile', options);
                    if (read.data !== data) throw new Error('Native cache roundtrip mismatch');
                    window.__fileSmokeUri = result.uri; window.__fileSmoke = 'ok';
                  } catch(e) { window.__fileSmoke = 'error: ' + e.message; }
                })();
                """);
            awaitTrue(scenario, "!!window.__fileSmoke && window.__fileSmoke !== 'running'");
            assertEquals("\"ok\"", evaluate(scenario, "window.__fileSmoke"));
            String fileUri = new JSONArray("[" + evaluate(scenario, "window.__fileSmokeUri") + "]").getString(0);
            Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
            File file = new File(Uri.parse(fileUri).getPath());
            assertTrue(file.getCanonicalPath().startsWith(new File(context.getCacheDir(), "exports").getCanonicalPath() + "/"));
            Uri contentUri = FileProvider.getUriForFile(context, APP_ID + ".fileprovider", file);
            assertEquals("content", contentUri.getScheme());
            try (InputStream input = context.getContentResolver().openInputStream(contentUri)) {
                assertNotNull(input); assertEquals('%', input.read());
            } finally { assertTrue("Test cache file was not removed", file.delete()); }
        }
    }

    @Test
    public void pdfSaveRejectsFilesOutsideThePreparedCacheDirectory() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitLibrary(scenario);
            evaluate(scenario, """
                (async () => {
                  window.__pdfSaveGuard = 'running';
                  try {
                    await Capacitor.nativePromise('PdfSave', 'save', {
                      sourceUri: 'file:///data/local/tmp/not-an-app-export.pdf', fileName: 'test.pdf'
                    });
                    window.__pdfSaveGuard = 'unexpected success';
                  } catch(e) { window.__pdfSaveGuard = e.message; }
                })();
                """);
            awaitTrue(scenario, "!!window.__pdfSaveGuard && window.__pdfSaveGuard !== 'running'");
            assertTrue(evaluate(scenario, "window.__pdfSaveGuard").contains("prepared PDF could not be read"));
        }
    }

}
