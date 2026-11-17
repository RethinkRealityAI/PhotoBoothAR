/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lucide icon names (as written in salesContent.ts) → components.
 *
 * A curated map rather than lucide's `icons` barrel: the barrel drags all
 * ~1,600 icons into the chunk. An unknown name falls back to Sparkles, so a
 * typo in the content can never crash a slide a prospect is looking at.
 */
import {
  Award, BadgeCheck, BarChart3, Bell, Bolt, Brain, Briefcase, Building2, Calendar, Camera, ChartLine,
  Clock, Cloud, Coins, Crown, DollarSign, Download, Eye, Film, Flame, Gauge, Gem, Gift, Globe, Hand,
  Handshake, Heart, ImageIcon, Infinity as InfinityIcon, Layers, LayoutGrid, Lightbulb, Link, Lock, Mail,
  Megaphone, MessageCircle, MonitorPlay, Music, Palette, PartyPopper, PenTool, Percent, PiggyBank,
  Printer, QrCode, Repeat, Rocket, ScanFace, Send, Share2, Shield, ShieldCheck, ShoppingBag, Smartphone,
  Smile, Sparkles, Star, Store, Target, Timer, TrendingUp, Trophy, Tv, Upload, UserCheck, UserPlus,
  Users, Video, Wallet, Wand2, Wifi, Zap, Box, Mic, MapPin, Ticket, Glasses, Banknote, Receipt,
  CircleCheck, Frame, Leaf, Hash, Instagram, Linkedin, Cpu, Clapperboard, Images, Wand, WandSparkles,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  Award, BadgeCheck, BarChart3, BarChart: BarChart3, Bell, Bolt, Brain, Briefcase, Building2, Building: Building2,
  Calendar, Camera, ChartLine, Clock, Cloud, Coins, Crown, DollarSign, Download, Eye, Film, Flame, Gauge, Gem,
  Gift, Globe, Hand, Handshake, Heart, Image: ImageIcon, ImageIcon, Images, Infinity: InfinityIcon, Layers,
  LayoutGrid, Lightbulb, Link, Lock, Mail, Megaphone, MessageCircle, MonitorPlay, Music, Palette, PartyPopper,
  PenTool, Percent, PiggyBank, Printer, QrCode, Repeat, Rocket, ScanFace, Send, Share2, Share: Share2, Shield,
  ShieldCheck, ShoppingBag, Smartphone, Smile, Sparkles, Star, Store, Target, Timer, TrendingUp, Trophy, Tv,
  Upload, UserCheck, UserPlus, Users, Video, Wallet, Wand, Wand2, WandSparkles, Wifi, Zap, Box, Mic, MapPin,
  Ticket, Glasses, Banknote, Receipt, CircleCheck, CheckCircle: CircleCheck, Leaf, Hash, Instagram, Linkedin,
  Cpu, Clapperboard, Frame,
};

/** Resolve an icon by name; unknown or missing → Sparkles. */
export function iconFor(name: string | undefined): LucideIcon {
  if (name === undefined) return Sparkles;
  return Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : Sparkles;
}
