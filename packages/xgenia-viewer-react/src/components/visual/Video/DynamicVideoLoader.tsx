import { useState, useCallback } from 'react';

interface DynamicVideoState {
  videoSource: string | null;
  isLoading: boolean;
  error: string | null;
}

interface DynamicVideoHook {
  videoSource: string | null;
  isLoading: boolean;
  error: string | null;
  loadVideoFile: (file: File) => Promise<void>;
  loadVideoFromUrl: (url: string) => Promise<void>;
  clearVideo: () => void;
}

export const useDynamicVideo = (): DynamicVideoHook => {
  const [state, setState] = useState<DynamicVideoState>({
    videoSource: null,
    isLoading: false,
    error: null
  });

  const loadVideoFile = useCallback(async (file: File): Promise<void> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
     
      if (!file.type.startsWith('video/') && file.type !== 'image/webp') {
        throw new Error('File yang dipilih bukan file video atau animated WebP');
      }

      
      const blobUrl = URL.createObjectURL(file);
      
      setState(prev => ({
        ...prev,
        videoSource: blobUrl,
        isLoading: false,
        error: null
      }));

    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : 'Gagal memuat file video';
      setState(prev => ({
        ...prev,
        videoSource: null,
        isLoading: false,
        error: errorMessage
      }));
      throw error;
    }
  }, []);

  const loadVideoFromUrl = useCallback(async (url: string): Promise<void> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      
      if (!url || url.trim() === '') {
        throw new Error('URL tidak boleh kosong');
      }

     
      if (isBase64String(url)) {
        const dataUrl = `data:video/mp4;base64,${url}`;
        setState(prev => ({
          ...prev,
          videoSource: dataUrl,
          isLoading: false,
          error: null
        }));
        return;
      }

     
      setState(prev => ({
        ...prev,
        videoSource: url,
        isLoading: false,
        error: null
      }));

    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : 'Gagal memuat video dari URL';
      setState(prev => ({
        ...prev,
        videoSource: null,
        isLoading: false,
        error: errorMessage
      }));
      throw error;
    }
  }, []);

  const clearVideo = useCallback(() => {
    // Cleanup blob URL jika ada
    if (state.videoSource && state.videoSource.startsWith('blob:')) {
      URL.revokeObjectURL(state.videoSource);
    }

    setState({
      videoSource: null,
      isLoading: false,
      error: null
    });
  }, [state.videoSource]);

  return {
    videoSource: state.videoSource,
    isLoading: state.isLoading,
    error: state.error,
    loadVideoFile,
    loadVideoFromUrl,
    clearVideo
  };
};


const isBase64String = (str: string): boolean => {
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  return str.length > 100 && str.length % 4 === 0 && base64Regex.test(str);
};


export const createDynamicVideoLoader = (config?: {
  allowedFormats?: string[];
  maxFileSize?: number;
}) => {
  const allowedFormats = config?.allowedFormats || ['video/mp4', 'video/webm', 'video/ogg', 'image/webp'];
  const maxFileSize = config?.maxFileSize || 100 * 1024 * 1024; // 100MB default

  return (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      
      if (!allowedFormats.includes(file.type)) {
        reject(new Error(`Format ${file.type} tidak didukung. Format yang didukung: ${allowedFormats.join(', ')}`));
        return;
      }

      
      if (file.size > maxFileSize) {
        reject(new Error(`Ukuran file terlalu besar. Maksimal ${Math.round(maxFileSize / 1024 / 1024)}MB`));
        return;
      }

      
      const blobUrl = URL.createObjectURL(file);
      resolve(blobUrl);
    });
  };
}; 