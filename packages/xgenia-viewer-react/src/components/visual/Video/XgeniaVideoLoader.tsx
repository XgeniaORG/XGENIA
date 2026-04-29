import React, { useState, useEffect } from 'react';

import { useDynamicVideo } from './DynamicVideoLoader';
import { Video, VideoProps } from './Video';

interface XgeniaVideoLoaderProps extends VideoProps {
  // Props dari XGENIA
  src?: string; // Dari String node connection
  enableDynamicLoading?: boolean;
  localVideoPath?: string; // Path untuk video lokal
  baseVideoUrl?: string; // Base URL untuk video assets
}

export const XgeniaVideoLoader: React.FC<XgeniaVideoLoaderProps> = ({
  src,
  enableDynamicLoading = true,
  localVideoPath,
  baseVideoUrl = '/assets/videos/', // Default path untuk video assets
  ...videoProps
}) => {
  const [resolvedSrc, setResolvedSrc] = useState<string>('');
  const [showFilePicker, setShowFilePicker] = useState<boolean>(false);
  const { videoSource, loadVideoFile, loadVideoFromUrl, clearVideo } = useDynamicVideo();

  // Effect untuk resolve video source dari berbagai kemungkinan
  useEffect(() => {
    const resolveVideoSource = async () => {
      if (!src) {
        setResolvedSrc('');
        return;
      }

      // 1. Jika sudah blob URL atau data URL, gunakan langsung
      if (src.startsWith('blob:') || src.startsWith('data:')) {
        setResolvedSrc(src);
        return;
      }

      // 2. Jika HTTP/HTTPS URL, gunakan langsung
      if (src.startsWith('http://') || src.startsWith('https://')) {
        setResolvedSrc(src);
        return;
      }

      // 3. Jika file:// URL, gunakan langsung (untuk Electron)
      if (src.startsWith('file://')) {
        setResolvedSrc(src);
        return;
      }

      // 4. Jika nama file saja (seperti "AnimationIcon7.mp4")
      if (src && !src.includes('/')) {
        // Coba berbagai kemungkinan path
        const possiblePaths = [
          // Relative ke base URL
          `${baseVideoUrl}${src}`,
          // Public folder
          `/public/videos/${src}`,
          `/videos/${src}`,
          `/assets/${src}`,
          // Root
          `/${src}`,
          // Local path jika ada
          localVideoPath ? `${localVideoPath}/${src}` : null
        ].filter(Boolean);

        // Coba setiap path sampai ada yang berhasil
        for (const path of possiblePaths) {
          if (!path) continue;
          try {
            const response = await fetch(path, { method: 'HEAD' });
            if (response.ok) {
              setResolvedSrc(path);
              return;
            }
          } catch (error: any) {
            // Continue ke path berikutnya
            continue;
          }
        }

        // Jika tidak ada yang berhasil, tampilkan file picker
        console.warn(`Video file "${src}" tidak ditemukan di path manapun. Menampilkan file picker.`);
        if (enableDynamicLoading) {
          setShowFilePicker(true);
        }
        return;
      }

      // 5. Jika path relatif atau absolut
      setResolvedSrc(src);
    };

    resolveVideoSource();
  }, [src, baseVideoUrl, localVideoPath, enableDynamicLoading]);

  // Gunakan videoSource dari dynamic loader jika ada, jika tidak gunakan resolvedSrc
  const finalVideoSrc = videoSource || resolvedSrc;

  const handleFileSelect = async (file: File) => {
    try {
      await loadVideoFile(file);
      setShowFilePicker(false);
    } catch (error: any) {
      console.error('Error loading video file:', error);
    }
  };

  const handleUrlLoad = async (url: string) => {
    try {
      await loadVideoFromUrl(url);
      setShowFilePicker(false);
    } catch (error: any) {
      console.error('Error loading video from URL:', error);
    }
  };

  // Jika tidak ada video source dan dynamic loading enabled, tampilkan controls
  if (!finalVideoSrc && enableDynamicLoading) {
    return (
      <div
        style={{
          ...videoProps.style,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px dashed #ccc',
          borderRadius: '8px',
          padding: '20px',
          backgroundColor: '#f9f9f9'
        }}
      >
        <div style={{ marginBottom: '15px', textAlign: 'center' }}>
          <h4 style={{ margin: '0 0 10px 0', color: '#666' }}>Video "{src}" tidak ditemukan</h4>
          <p style={{ margin: '0', fontSize: '14px', color: '#888' }}>
            Pilih file video atau masukkan URL untuk melanjutkan
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input
            type="file"
            accept="video/*,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
            }}
            style={{ display: 'none' }}
            id="video-file-input"
          />

          <label
            htmlFor="video-file-input"
            style={{
              padding: '8px 16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              textDecoration: 'none',
              display: 'inline-block'
            }}
          >
            Pilih File Video
          </label>

          <button
            onClick={() => {
              const url = prompt('Masukkan URL video:');
              if (url) handleUrlLoad(url);
            }}
            style={{
              padding: '8px 16px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Load dari URL
          </button>

          {(videoSource || resolvedSrc) && (
            <button
              onClick={() => {
                clearVideo();
                setResolvedSrc('');
              }}
              style={{
                padding: '8px 16px',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Clear
            </button>
          )}
        </div>

        {src && <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>Mencoba memuat: {src}</div>}
      </div>
    );
  }

  // Jika ada video source, render Video component normal
  if (finalVideoSrc) {
    return (
      <Video
        {...videoProps}
        dom={{
          ...videoProps.dom,
          src: finalVideoSrc
        }}
        onCanPlay={() => {
          console.log('Video loaded successfully:', finalVideoSrc);
          videoProps.onCanPlay?.();
        }}
      />
    );
  }

  // Fallback jika tidak ada source dan dynamic loading disabled
  return (
    <div
      style={{
        ...videoProps.style,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f0f0f0',
        color: '#666',
        border: '1px solid #ddd'
      }}
    >
      {src ? `Video tidak ditemukan: ${src}` : 'Tidak ada video source'}
    </div>
  );
};

// Helper function untuk setup video assets path
export const setupVideoAssetsPath = (basePath: string) => {
  // Simpan ke local storage atau context untuk digunakan globally
  localStorage.setItem('xgenia-video-base-path', basePath);
};

// Hook untuk mendapatkan video assets path
export const useVideoAssetsPath = (): string => {
  const [basePath, setBasePath] = useState<string>(() => {
    return localStorage.getItem('xgenia-video-base-path') || '/assets/videos/';
  });

  useEffect(() => {
    const handleStorageChange = () => {
      const newPath = localStorage.getItem('xgenia-video-base-path');
      if (newPath) setBasePath(newPath);
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  return basePath;
};

// Utility function untuk mendeteksi apakah running di Electron
export const isElectron = (): boolean => {
  return !!(typeof window !== 'undefined' && (window as any).process && (window as any).require);
};

// Component wrapper untuk integrasi mudah dengan XGENIA
export const XgeniaVideoWrapper: React.FC<
  VideoProps & {
    enableDynamicLoading?: boolean;
    videoAssetsPath?: string;
  }
> = ({ enableDynamicLoading = true, videoAssetsPath, ...props }) => {
  const defaultAssetsPath = useVideoAssetsPath();

  return (
    <XgeniaVideoLoader
      {...props}
      enableDynamicLoading={enableDynamicLoading}
      baseVideoUrl={videoAssetsPath || defaultAssetsPath}
    />
  );
};
