import mongoose, { Document, Schema } from 'mongoose';

export interface IProduct {
  name: string;
  description: string;
  price: number;
  category: string;
  stock: number;
  active: boolean;
  images: string[];
  attributes?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IProductDocument extends IProduct, Document {}

const productSchema = new Schema<IProductDocument>(
  {
    name: {
      type: String,
      required: [true, 'O nome do produto é obrigatório'],
      trim: true,
      minlength: 2,
      maxlength: 200,
    },
    description: {
      type: String,
      required: [true, 'A descrição do produto é obrigatória'],
      trim: true,
      maxlength: 3000,
    },
    price: {
      type: Number,
      required: [true, 'O preço é obrigatório'],
      min: [0, 'O preço deve ser maior ou igual a zero'],
    },
    category: {
      type: String,
      required: [true, 'A categoria é obrigatória'],
      trim: true,
      index: true,
    },
    stock: {
      type: Number,
      required: [true, 'A quantidade em estoque é obrigatória'],
      min: [0, 'O estoque não pode ser negativo'],
      default: 0,
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
    images: {
      type: [String],
      default: [],
    },
    attributes: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, any>) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Índices para busca textual e filtros compostos eficientes
productSchema.index({ name: 'text', description: 'text' });
productSchema.index({ category: 1, active: 1, price: 1 });

export const ProductModel = mongoose.model<IProductDocument>('Product', productSchema);
