import { FilterQuery } from 'mongoose';
import { IProduct, IProductDocument, ProductModel } from '../models/product.model';
import { AppError } from '../middlewares/error.middleware';

export interface CreateProductDTO {
  name: string;
  description: string;
  price: number;
  category: string;
  stock: number;
  active?: boolean;
  images?: string[];
  attributes?: Record<string, any>;
}

export interface UpdateProductDTO {
  name?: string;
  description?: string;
  price?: number;
  category?: string;
  stock?: number;
  active?: boolean;
  images?: string[];
  attributes?: Record<string, any>;
}

export interface ListProductsFilter {
  page?: number;
  limit?: number;
  category?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: 'price_asc' | 'price_desc' | 'newest';
}

export class ProductService {
  async create(data: CreateProductDTO): Promise<IProductDocument> {
    const product = new ProductModel(data);
    return await product.save();
  }

  async getById(id: string): Promise<IProductDocument> {
    const product = await ProductModel.findById(id);
    if (!product) {
      throw new AppError(404, 'Produto não encontrado');
    }
    return product;
  }

  async list(filter: ListProductsFilter): Promise<{
    products: IProductDocument[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const page = Math.max(filter.page || 1, 1);
    const limit = Math.min(filter.limit || 20, 100);
    const skip = (page - 1) * limit;

    const query: FilterQuery<IProductDocument> = { active: true };

    if (filter.category) {
      query.category = { $regex: new RegExp(`^${filter.category}$`, 'i') };
    }

    if (filter.minPrice !== undefined || filter.maxPrice !== undefined) {
      query.price = {};
      if (filter.minPrice !== undefined) query.price.$gte = filter.minPrice;
      if (filter.maxPrice !== undefined) query.price.$lte = filter.maxPrice;
    }

    if (filter.search) {
      query.$text = { $search: filter.search };
    }

    let sortOption: any = { createdAt: -1 };
    if (filter.sort === 'price_asc') sortOption = { price: 1 };
    if (filter.sort === 'price_desc') sortOption = { price: -1 };
    if (filter.sort === 'newest') sortOption = { createdAt: -1 };

    const [products, total] = await Promise.all([
      ProductModel.find(query).sort(sortOption).skip(skip).limit(limit),
      ProductModel.countDocuments(query),
    ]);

    return {
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async update(id: string, data: UpdateProductDTO): Promise<IProductDocument> {
    const updated = await ProductModel.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });

    if (!updated) {
      throw new AppError(404, 'Produto não encontrado para atualização');
    }

    return updated;
  }

  async delete(id: string): Promise<void> {
    const result = await ProductModel.findByIdAndDelete(id);
    if (!result) {
      throw new AppError(404, 'Produto não encontrado para exclusão');
    }
  }

  async updateStock(id: string, delta: number): Promise<IProductDocument> {
    // Para decrementos (reserva/venda), garante atomicamente que o estoque não fique negativo
    const filter: FilterQuery<IProductDocument> = { _id: id };
    if (delta < 0) {
      filter.stock = { $gte: Math.abs(delta) };
    }

    const updated = await ProductModel.findOneAndUpdate(
      filter,
      { $inc: { stock: delta } },
      { new: true }
    );

    if (!updated) {
      // Verifica se o produto existe para dar mensagem de erro precisa
      const exists = await ProductModel.findById(id);
      if (!exists) {
        throw new AppError(404, 'Produto não encontrado');
      }
      throw new AppError(409, 'Estoque insuficiente para a quantidade solicitada');
    }

    return updated;
  }
}

export const productService = new ProductService();
