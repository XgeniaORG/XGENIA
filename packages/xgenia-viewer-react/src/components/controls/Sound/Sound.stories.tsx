import type { Meta, StoryObj } from '@storybook/react';
import { Sound } from './Sound';

const meta: Meta<typeof Sound> = {
  title: 'Controls/Sound',
  component: Sound,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    volume: {
      control: { type: 'range', min: 0, max: 1, step: 0.1 }
    },
    playbackRate: {
      control: { type: 'range', min: 0.1, max: 4, step: 0.1 }
    },
    loop: {
      control: 'boolean'
    },
    interrupt: {
      control: 'boolean'
    },
    showControls: {
      control: 'boolean'
    },
    showVolumeSlider: {
      control: 'boolean'
    }
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic sound with controls
export const WithControls: Story = {
  args: {
    soundUrl: '/sounds/boop.mp3', // You would need to add sample audio files
    volume: 0.5,
    playbackRate: 1.0,
    loop: false,
    interrupt: false,
    showControls: true,
    showVolumeSlider: true,
    onPlay: () => console.log('Sound started'),
    onPause: () => console.log('Sound paused'),
    onStop: () => console.log('Sound stopped'),
    onEnd: () => console.log('Sound ended'),
    onLoad: () => console.log('Sound loaded'),
    onError: (error) => console.error('Sound error:', error),
  },
};

// Hidden component (just the logic, no UI)
export const Hidden: Story = {
  args: {
    soundUrl: '/sounds/click.mp3',
    volume: 0.8,
    showControls: false,
    onPlay: () => console.log('Click sound played'),
  },
};

// With sprite support
export const WithSprites: Story = {
  args: {
    soundUrl: '/sounds/drum-sprites.mp3',
    sprite: '{"kick": [0, 350], "snare": [400, 300], "hihat": [750, 200]}',
    spriteId: 'kick',
    volume: 0.7,
    showControls: true,
    onPlay: () => console.log('Sprite played'),
  },
};

// Auto-playing background music
export const BackgroundMusic: Story = {
  args: {
    soundUrl: '/sounds/background.mp3',
    volume: 0.3,
    loop: true,
    autoPlay: true,
    showControls: true,
    showVolumeSlider: true,
    onPlay: () => console.log('Background music started'),
    onEnd: () => console.log('Background music ended'),
  },
};
